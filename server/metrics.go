package main

import (
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"
)

func (a *app) handleAnalytics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := a.requireOwner(w, r); !ok {
		return
	}
	snapshot := a.obs.snapshot()
	snapshot["ioUring"] = ioUringActive.Load()
	snapshot["ioUringDial"] = ioUringDialActive.Load()
	writeJSON(w, http.StatusOK, snapshot)
}

func (a *app) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authorized := false
	if a.isAuthenticated(r) {
		if _, ok := a.requireOwner(w, r); !ok {
			return
		}
		authorized = true
	}
	if token := a.cfg.metricsToken; token != "" {
		authorized = authorized || subtleCompareBearer(r.Header.Get("Authorization"), token)
	}
	if !authorized && !remoteIP(r.RemoteAddr).IsLoopback() {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s := a.obs.snapshot()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP norav_http_requests_total Total HTTP requests handled by NoRav.\n# TYPE norav_http_requests_total counter\nnorav_http_requests_total %v\n", s["requests"])
	fmt.Fprintf(w, "# HELP norav_http_errors_total Total HTTP requests with status codes >= 400.\n# TYPE norav_http_errors_total counter\nnorav_http_errors_total %v\n", s["errors"])
	fmt.Fprintf(w, "# HELP norav_http_bytes_in_total Total request body bytes observed.\n# TYPE norav_http_bytes_in_total counter\nnorav_http_bytes_in_total %v\n", s["bytesIn"])
	fmt.Fprintf(w, "# HELP norav_http_bytes_out_total Total response body bytes written.\n# TYPE norav_http_bytes_out_total counter\nnorav_http_bytes_out_total %v\n", s["bytesOut"])
	fmt.Fprintf(w, "# HELP norav_http_request_average_latency_ms Average HTTP request latency in milliseconds.\n# TYPE norav_http_request_average_latency_ms gauge\nnorav_http_request_average_latency_ms %v\n", s["averageLatencyMs"])
	fmt.Fprintf(w, "# HELP norav_io_uring_active Whether the incoming io_uring listener path is active.\n# TYPE norav_io_uring_active gauge\nnorav_io_uring_active %d\n", boolInt(ioUringActive.Load()))
	fmt.Fprintf(w, "# HELP norav_io_uring_dial_active Whether outbound io_uring dialing is active.\n# TYPE norav_io_uring_dial_active gauge\nnorav_io_uring_dial_active %d\n", boolInt(ioUringDialActive.Load()))
	fmt.Fprintln(w, "# HELP norav_http_requests_by_method_total HTTP requests by method.\n# TYPE norav_http_requests_by_method_total counter")
	for method, count := range s["methods"].(map[string]uint64) {
		fmt.Fprintf(w, "norav_http_requests_by_method_total{method=%q} %d\n", method, count)
	}
	fmt.Fprintln(w, "# HELP norav_http_responses_by_status_total HTTP responses by status code.\n# TYPE norav_http_responses_by_status_total counter")
	for status, count := range s["statuses"].(map[string]uint64) {
		fmt.Fprintf(w, "norav_http_responses_by_status_total{status=%q} %d\n", status, count)
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func subtleCompareBearer(value, token string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(value, prefix)), []byte(token)) == 1
}
