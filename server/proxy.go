package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (a *app) handleProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		a.handleProxyOptions(w, r)
		return
	}
	sess, ok := a.requireSession(w, r)
	if !ok {
		return
	}
	clientIP := a.clientIP(r)
	if !a.requestLimiter.acquire(clientIP) {
		w.Header().Set("Retry-After", "2")
		http.Error(w, "Too many parallel requests from this client.", http.StatusTooManyRequests)
		return
	}
	defer a.requestLimiter.release(clientIP)
	if !allowedMethod(r.Method) {
		http.Error(w, "method not allowed", 405)
		return
	}
	target, err := requestedURL(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := validateTargetURL(target); err != nil {
		http.Error(w, "This destination is not available through NoRav.", 403)
		return
	}
	var body io.Reader
	if r.Body != nil {
		body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	}
	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), body)
	if err != nil {
		http.Error(w, "Could not create upstream request.", 400)
		return
	}
	copyRequestHeaders(upstream.Header, r.Header)
	for _, h := range []string{"X-NoRav-Target", "X-NoRav-Origin", "X-NoRav-Referer", "Cookie", "Origin", "Host", "Content-Length", "Accept-Encoding", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP"} {
		upstream.Header.Del(h)
	}
	if r.Header.Get("Origin") != "" {
		upstream.Header.Set("Origin", target.Scheme+"://"+target.Host)
	}
	if trace, ok := r.Context().Value(traceContextKey{}).(*traceContext); ok {
		upstream.Header.Set("X-Request-ID", trace.RequestID)
		upstream.Header.Set("traceparent", "00-"+trace.TraceID+"-"+randomHex(8)+"-01")
	}
	if referer := r.Header.Get("X-NoRav-Referer"); referer != "" {
		if parsed, e := url.Parse(referer); e == nil && parsed.IsAbs() && (parsed.Scheme == "http" || parsed.Scheme == "https") {
			upstream.Header.Set("Referer", parsed.String())
		}
	}
	client := &http.Client{
		Transport: a.transport, Jar: sess.jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			if err := validateTargetURL(req.URL); err != nil {
				return fmt.Errorf("redirect destination rejected: %w", err)
			}
			for _, h := range []string{"X-NoRav-Target", "X-NoRav-Origin", "X-NoRav-Referer"} {
				req.Header.Del(h)
			}
			return nil
		},
	}
	start := time.Now()
	resp, err := client.Do(upstream)
	if err != nil {
		log.Printf("upstream error host=%s err=%q", target.Hostname(), err)
		http.Error(w, "The destination could not be reached. Check the address and try again.", 502)
		return
	}
	defer resp.Body.Close()
	copyResponseHeaders(w.Header(), resp.Header)
	mediaType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if mediaType == "text/html" || mediaType == "application/xhtml+xml" {
		data, e := io.ReadAll(io.LimitReader(resp.Body, maxHTMLBytes+1))
		if e != nil {
			http.Error(w, "The destination returned an incomplete response.", 502)
			return
		}
		if int64(len(data)) <= maxHTMLBytes {
			rewritten, e := a.rewriteHTML(data, resp.Request.URL)
			if e != nil {
				log.Printf("html rewrite failed host=%s err=%q", target.Hostname(), e)
				w.WriteHeader(resp.StatusCode)
				_, _ = w.Write(data)
				return
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(rewritten)))
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(rewritten)
			log.Printf("proxy method=%s host=%s status=%d bytes=%d duration=%s", r.Method, target.Hostname(), resp.StatusCode, len(rewritten), time.Since(start).Round(time.Millisecond))
			return
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.MultiReader(bytes.NewReader(data), resp.Body))
		return
	}
	if mediaType == "text/css" || strings.Contains(mediaType, "javascript") || mediaType == "application/ecmascript" {
		data, e := io.ReadAll(io.LimitReader(resp.Body, maxTextBytes+1))
		if e != nil {
			http.Error(w, "The destination returned an incomplete response.", 502)
			return
		}
		if int64(len(data)) <= maxTextBytes {
			text := string(data)
			if mediaType == "text/css" {
				text = rewriteCSS(text, resp.Request.URL)
			} else {
				text = rewriteJavaScript(text, resp.Request.URL)
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(text)))
			w.WriteHeader(resp.StatusCode)
			_, _ = io.WriteString(w, text)
			log.Printf("proxy method=%s host=%s status=%d bytes=%d duration=%s", r.Method, target.Hostname(), resp.StatusCode, len(text), time.Since(start).Round(time.Millisecond))
			return
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.MultiReader(bytes.NewReader(data), resp.Body))
		return
	}
	w.WriteHeader(resp.StatusCode)
	written, _ := io.Copy(w, resp.Body)
	log.Printf("proxy method=%s host=%s status=%d bytes=%d duration=%s", r.Method, target.Hostname(), resp.StatusCode, written, time.Since(start).Round(time.Millisecond))
}

func (a *app) handleProxyOptions(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		http.Error(w, "origin required", http.StatusForbidden)
		return
	}
	parsed, err := url.Parse(origin)
	requestHost, hostErr := url.Parse("//" + r.Host)
	if err != nil || hostErr != nil || parsed.Hostname() == "" || requestHost.Hostname() == "" {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if !strings.EqualFold(parsed.Hostname(), requestHost.Hostname()) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	port := parsed.Port()
	if port != portOf(a.cfg.uiAddr) && port != portOf(a.cfg.proxyAddr) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-NoRav-Target, X-NoRav-Origin, X-NoRav-Referer")
	w.Header().Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}
