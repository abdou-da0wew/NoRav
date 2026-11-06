package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type traceContext struct {
	RequestID  string
	TraceID    string
	SpanID     string
	ParentSpan string
	ClientIP   string
	Started    time.Time
}

type traceContextKey struct{}

func randomHex(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(value)
}

func parseTraceParent(value string) (traceID, parentSpan string, ok bool) {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 4 || len(parts[0]) != 2 || len(parts[1]) != 32 || len(parts[2]) != 16 || len(parts[3]) != 2 {
		return "", "", false
	}
	for _, part := range parts {
		if _, err := hex.DecodeString(part); err != nil {
			return "", "", false
		}
	}
	if parts[1] == strings.Repeat("0", 32) || parts[2] == strings.Repeat("0", 16) {
		return "", "", false
	}
	return strings.ToLower(parts[1]), strings.ToLower(parts[2]), true
}

func (a *app) instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		clientIP := a.clientIP(r)
		traceID, parentSpan, ok := parseTraceParent(r.Header.Get("traceparent"))
		if !ok {
			traceID = randomHex(16)
			parentSpan = ""
		}
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if len(requestID) < 8 || len(requestID) > 96 || strings.ContainsAny(requestID, " \r\n\t") {
			requestID = randomHex(12)
		}
		spanID := randomHex(8)
		info := &traceContext{
			RequestID:  requestID,
			TraceID:    traceID,
			SpanID:     spanID,
			ParentSpan: parentSpan,
			ClientIP:   clientIP,
			Started:    started,
		}
		ctx := context.WithValue(r.Context(), traceContextKey{}, info)
		r = r.WithContext(ctx)
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("traceparent", "00-"+traceID+"-"+spanID+"-01")
		tracker := &trackingResponseWriter{ResponseWriter: w}
		next.ServeHTTP(tracker, r)
		if tracker.status == 0 {
			tracker.status = http.StatusOK
		}
		duration := time.Since(started)
		host := upstreamHost(r)
		bytesIn := r.ContentLength
		if bytesIn < 0 {
			bytesIn = 0
		}
		event := requestEvent{
			Time: started.UTC(), RequestID: requestID, TraceID: traceID, ClientIP: clientIP,
			Method: r.Method, Path: r.URL.Path, Host: host, Status: tracker.status,
			DurationMS: float64(duration.Microseconds()) / 1000,
			BytesIn:    bytesIn, BytesOut: tracker.bytes,
		}
		a.obs.record(event, duration)
		slog.Info("http_request",
			"request_id", requestID,
			"trace_id", traceID,
			"span_id", spanID,
			"parent_span_id", parentSpan,
			"client_ip", clientIP,
			"method", r.Method,
			"path", r.URL.Path,
			"upstream_host", host,
			"status", tracker.status,
			"bytes_in", bytesIn,
			"bytes_out", tracker.bytes,
			"duration_ms", event.DurationMS,
			"user_agent", r.UserAgent(),
		)
	})
}

func upstreamHost(r *http.Request) string {
	raw := r.URL.Query().Get("url")
	if raw == "" {
		raw = r.Header.Get("X-NoRav-Target")
	}
	if raw == "" {
		if destination, ok := destinationFromEnginePath(r.URL.Path, r.URL.RawQuery); ok {
			return strings.ToLower(destination.Hostname())
		}
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

type trackingResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *trackingResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *trackingResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	w.bytes += int64(n)
	return n, err
}

func (w *trackingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *trackingResponseWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *trackingResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
