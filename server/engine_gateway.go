package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

type engineSessionRequest struct {
	URL string `json:"url"`
}

type engineSessionResponse struct {
	URL      string `json:"url"`
	EngineID string `json:"engineId"`
}

func (a *app) handleProxySession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}

	current, ok := a.requireSession(w, r)
	if !ok {
		return
	}
	var input engineSessionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid browsing request."})
		return
	}

	target, err := url.Parse(strings.TrimSpace(input.URL))
	if err != nil || !target.IsAbs() {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Enter a complete website address."})
		return
	}
	if err := validateTargetURL(target); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "This destination is not available through NoRav."})
		return
	}

	sid, err := r.Cookie(sessionCookie)
	if err != nil || sid.Value == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "NoRav session has expired."})
		return
	}

	result, err := a.requestEngineSession(r, sid.Value, target.String())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "The proxy engine could not create a browsing session."})
		return
	}
	if result.EngineID == "" || !a.validEngineURL(r, result.URL, result.EngineID) {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "The browsing engine returned an invalid destination."})
		return
	}

	a.mu.Lock()
	if active := a.sessions[sid.Value]; active != nil && active == current {
		active.engineID = result.EngineID
	}
	a.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"url": result.URL})
}

func (a *app) validEngineURL(r *http.Request, raw, engineID string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.User != nil {
		return false
	}
	scheme := "http"
	host := r.Host
	if r.TLS != nil {
		scheme = "https"
	}
	if remoteIP(r.RemoteAddr).IsLoopback() {
		forwardedProto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
		if forwardedProto == "http" || forwardedProto == "https" {
			scheme = forwardedProto
		}
		if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
			host = forwardedHost
		}
	}
	if parsed.Scheme != scheme {
		return false
	}
	hostname, _, err := net.SplitHostPort(host)
	if err != nil {
		hostname = strings.Trim(host, "[]")
	}
	if hostname == "" {
		return false
	}
	publicPort := a.cfg.publicProxyPort
	if publicPort == "" {
		publicPort = portOf(a.cfg.proxyAddr)
	}
	expectedHost := net.JoinHostPort(hostname, publicPort)
	if !strings.EqualFold(parsed.Host, expectedHost) {
		return false
	}
	first := strings.Split(strings.Trim(parsed.Path, "/"), "/")[0]
	return first == engineID
}

func (a *app) handleEngineProxy(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		a.handleHealth(w, r)
		return
	}
	if a.engineProxy == nil {
		http.Error(w, "The browsing engine is not ready.", http.StatusBadGateway)
		return
	}
	sess, ok := a.requireSession(w, r)
	if !ok {
		return
	}
	engineID := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/"), "/", 2)[0]
	if descriptor := strings.IndexByte(engineID, '!'); descriptor >= 0 {
		engineID = engineID[:descriptor]
	}
	sessionKey := rCookieValue(r, sessionCookie)

	// Hammerhead serves a small fixed set of shared runtime resources and its
	// cookie/message transport outside the per-session URL namespace. These
	// endpoints are available only to authenticated NoRav sessions; all
	// destination and session-specific URLs remain bound to the owning SID.
	if isHammerheadRuntimeRoute(r.URL.Path) {
		a.engineProxy.ServeHTTP(w, r)
		return
	}

	a.mu.Lock()
	allowed := engineID != "" && sess.engineID != "" &&
		sess.engineID == engineID && a.sessions[sessionKey] == sess
	a.mu.Unlock()
	if !allowed {
		if a.recoverStaleEngineNavigation(w, r, sessionKey, sess) {
			return
		}
		http.Error(w, "This browsing session is not available.", http.StatusForbidden)
		return
	}

	a.engineProxy.ServeHTTP(w, r)
}

func isHammerheadRuntimeRoute(path string) bool {
	switch path {
	case "/hammerhead.js", "/task.js", "/iframe-task.js",
		"/transport-worker.js", "/worker-hammerhead.js", "/messaging":
		return true
	default:
		return false
	}
}

func (a *app) recoverStaleEngineNavigation(w http.ResponseWriter, r *http.Request, sessionKey string, current *session) bool {
	if (r.Method != http.MethodGet && r.Method != http.MethodHead) || sessionKey == "" || current == nil {
		return false
	}
	destinationKind := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Dest")))
	if destinationKind != "" && destinationKind != "document" && destinationKind != "iframe" {
		return false
	}
	target, ok := destinationFromEnginePath(r.URL.Path, r.URL.RawQuery)
	if !ok {
		return false
	}
	if err := validateTargetURL(target); err != nil {
		http.Error(w, "This NoRav browsing link has expired. Open the website again from the browser.", http.StatusGone)
		return true
	}

	result, err := a.requestEngineSession(r, sessionKey, target.String())
	if err != nil {
		http.Error(w, "NoRav could not restore this browsing session. Unlock the dashboard and retry.", http.StatusBadGateway)
		return true
	}
	if result.EngineID == "" || !a.validEngineURL(r, result.URL, result.EngineID) {
		http.Error(w, "The browsing engine returned an invalid destination.", http.StatusBadGateway)
		return true
	}

	a.mu.Lock()
	active := a.sessions[sessionKey] == current
	if active {
		current.engineID = result.EngineID
	}
	a.mu.Unlock()
	if !active {
		http.Error(w, "The NoRav session expired. Unlock the dashboard and retry.", http.StatusUnauthorized)
		return true
	}

	http.Redirect(w, r, result.URL, http.StatusTemporaryRedirect)
	return true
}

func destinationFromEnginePath(proxyPath, rawQuery string) (*url.URL, bool) {
	path := strings.TrimPrefix(proxyPath, "/")
	_, rawDestination, found := strings.Cut(path, "/")
	if !found {
		return nil, false
	}
	target, err := url.Parse(rawDestination)
	if err != nil || !target.IsAbs() || target.Hostname() == "" || target.User != nil {
		return nil, false
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, false
	}
	if rawQuery != "" {
		target.RawQuery = rawQuery
	}
	return target, true
}

func (a *app) requestEngineSession(r *http.Request, sessionKey, target string) (engineSessionResponse, error) {
	var result engineSessionResponse
	payload, err := json.Marshal(map[string]string{"sessionKey": sessionKey, "target": target})
	if err != nil {
		return result, fmt.Errorf("prepare engine session: %w", err)
	}
	endpoint := "http://" + a.cfg.engineControlAddr + "/session"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return result, fmt.Errorf("build engine session request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NoRav-Internal-Token", hex.EncodeToString(a.cfg.cookieKey))
	client := &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			Proxy:        nil,
			DialContext:  (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			MaxIdleConns: 8, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second,
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return result, fmt.Errorf("request engine session: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return result, fmt.Errorf("engine session returned status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
		return result, fmt.Errorf("decode engine session response: %w", err)
	}
	return result, nil
}

func rCookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func stripNoRavCookies(raw string) string {
	if raw == "" {
		return raw
	}
	blocked := map[string]struct{}{
		authCookie: {}, sessionCookie: {}, refreshCookie: {}, "norav_device": {},
	}
	parts := strings.Split(raw, ";")
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		name, _, _ := strings.Cut(strings.TrimSpace(part), "=")
		if _, found := blocked[name]; !found && name != "" {
			kept = append(kept, strings.TrimSpace(part))
		}
	}
	return strings.Join(kept, "; ")
}

func newEngineProxy(addr string) (*httputil.ReverseProxy, error) {
	target, err := url.Parse("http://" + addr)
	if err != nil || target.Host == "" {
		return nil, fmt.Errorf("invalid proxy engine address")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalHost := req.Host
		browserCookies := req.Header.Get("Cookie")
		director(req)
		req.Host = originalHost
		filtered := stripNoRavCookies(browserCookies)
		if filtered == "" {
			req.Header.Del("Cookie")
		} else {
			req.Header.Set("Cookie", filtered)
		}
		req.Header.Del("X-NoRav-Internal-Token")
	}
	proxy.FlushInterval = -1
	proxy.ModifyResponse = func(response *http.Response) error {
		normalizeProxyResponseHeaders(response.Header)
		response.Header.Del("X-Frame-Options")
		for _, name := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
			values := response.Header.Values(name)
			if len(values) == 0 {
				continue
			}
			response.Header.Del(name)
			for _, value := range values {
				filtered := stripFrameAncestorsDirective(value)
				if filtered != "" {
					response.Header.Add(name, filtered)
				}
			}
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "The browsing engine could not complete this request.", http.StatusBadGateway)
	}
	return proxy, nil
}

// normalizeProxyResponseHeaders removes destination isolation policies that are
// invalid after Hammerhead maps unrelated destinations onto one browser origin.
// OAC is explicitly kept site-keyed for every proxied response to avoid mixing
// origin-keyed and site-keyed agent clusters on NoRav's shared proxy origin.
func normalizeProxyResponseHeaders(header http.Header) {
	for _, name := range []string{
		"Cross-Origin-Opener-Policy",
		"Cross-Origin-Opener-Policy-Report-Only",
		"Cross-Origin-Embedder-Policy",
		"Cross-Origin-Embedder-Policy-Report-Only",
		"Cross-Origin-Resource-Policy",
		"Strict-Transport-Security",
		"Alt-Svc",
		"Clear-Site-Data",
		"Report-To",
		"Reporting-Endpoints",
		"Nel",
		"Origin-Trial",
		"Critical-Origin-Trial",
	} {
		header.Del(name)
	}
	header.Set("Origin-Agent-Cluster", "?0")
}

func stripFrameAncestorsDirective(policy string) string {
	directives := strings.Split(policy, ";")
	kept := make([]string, 0, len(directives))
	for _, directive := range directives {
		trimmed := strings.TrimSpace(directive)
		if trimmed == "" {
			continue
		}
		name := strings.Fields(trimmed)[0]
		if strings.EqualFold(name, "frame-ancestors") {
			continue
		}
		kept = append(kept, trimmed)
	}
	return strings.Join(kept, "; ")
}
