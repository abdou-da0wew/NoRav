package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDestinationFromEnginePathSupportsHTTPAndHTTPS(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "http", path: "/old-id/http://info.cern.ch/", want: "http://info.cern.ch/"},
		{name: "https", path: "/old-id/https://google.com/search", want: "https://google.com/search"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := destinationFromEnginePath(test.path, "")
			if !ok || got.String() != test.want {
				t.Fatalf("destinationFromEnginePath() = (%v, %v), want (%s, true)", got, ok, test.want)
			}
		})
	}
}

func TestDestinationFromEnginePathPreservesQuery(t *testing.T) {
	got, ok := destinationFromEnginePath("/old-id/https://example.com/search", "q=norav&page=2")
	if !ok || got.String() != "https://example.com/search?q=norav&page=2" {
		t.Fatalf("destinationFromEnginePath() = (%v, %v)", got, ok)
	}
}

func TestDestinationFromEnginePathRejectsNonNavigationRoutes(t *testing.T) {
	for _, path := range []string{
		"/old-id/hammerhead.js",
		"/old-id/ftp://example.com/",
		"/old-id/https://user:pass@example.com/",
		"/old-id/https:///missing-host",
	} {
		if got, ok := destinationFromEnginePath(path, ""); ok {
			t.Errorf("destinationFromEnginePath(%q) unexpectedly returned %v", path, got)
		}
	}
}

func TestStripFrameAncestorsDirective(t *testing.T) {
	input := "default-src 'self'; frame-ancestors 'none'; script-src https://cdn.example.test"
	got := stripFrameAncestorsDirective(input)
	want := "default-src 'self'; script-src https://cdn.example.test"
	if got != want {
		t.Fatalf("unexpected CSP rewrite: got %q want %q", got, want)
	}
}

func TestStripFrameAncestorsDirectiveCaseInsensitive(t *testing.T) {
	input := "FRAME-ANCESTORS https://blocked.example; img-src https:"
	got := stripFrameAncestorsDirective(input)
	want := "img-src https:"
	if got != want {
		t.Fatalf("unexpected CSP rewrite: got %q want %q", got, want)
	}
}

func TestNormalizeProxyResponseHeaders(t *testing.T) {
	header := http.Header{
		"Cross-Origin-Opener-Policy":             {"same-origin-allow-popups"},
		"Cross-Origin-Opener-Policy-Report-Only": {"same-origin"},
		"Cross-Origin-Embedder-Policy":           {"require-corp"},
		"Cross-Origin-Resource-Policy":           {"same-origin"},
		"Origin-Agent-Cluster":                   {"?1"},
		"Retry-After":                            {"7"},
	}

	normalizeProxyResponseHeaders(header)

	for _, name := range []string{
		"Cross-Origin-Opener-Policy",
		"Cross-Origin-Opener-Policy-Report-Only",
		"Cross-Origin-Embedder-Policy",
		"Cross-Origin-Resource-Policy",
	} {
		if got := header.Get(name); got != "" {
			t.Errorf("%s = %q, want removed", name, got)
		}
	}
	if got := header.Get("Origin-Agent-Cluster"); got != "?0" {
		t.Errorf("Origin-Agent-Cluster = %q, want ?0", got)
	}
	if got := header.Get("Retry-After"); got != "7" {
		t.Errorf("Retry-After = %q, want preserved", got)
	}
}

func TestValidEngineURLUsesTrustedPublicOriginBehindTLSProxy(t *testing.T) {
	a := &app{cfg: config{proxyAddr: "127.0.0.1:17899", publicProxyPort: "8099"}}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:17899/", nil)
	req.RemoteAddr = "127.0.0.1:43210"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "celestial-bot.work.gd:8099")

	if !a.validEngineURL(req, "https://celestial-bot.work.gd:8099/engine-id/https://instagram.com/", "engine-id") {
		t.Fatal("valid HTTPS engine URL behind trusted TLS proxy was rejected")
	}
}

func TestValidEngineURLDoesNotTrustForwardedHeadersFromPublicClient(t *testing.T) {
	a := &app{cfg: config{proxyAddr: "127.0.0.1:17899", publicProxyPort: "8099"}}
	req := httptest.NewRequest(http.MethodGet, "http://5.83.153.107:8099/", nil)
	req.RemoteAddr = "203.0.113.5:43210"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "celestial-bot.work.gd:8099")

	if a.validEngineURL(req, "https://celestial-bot.work.gd:8099/engine-id/https://instagram.com/", "engine-id") {
		t.Fatal("untrusted forwarded headers were accepted from a public client")
	}
}

func TestEngineProxyPreservesUpstreamRateLimitAndStripsOriginScopedHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "celestial-bot.work.gd:8099" {
			t.Errorf("upstream Host = %q, want public proxy host", r.Host)
		}
		if got := r.Header.Get("Cookie"); got != "ig_did=upstream-session" {
			t.Errorf("upstream Cookie = %q, want only destination cookies", got)
		}
		w.Header().Set("Retry-After", "30")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Origin-Agent-Cluster", "?1")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("Alt-Svc", `h3=":443"`)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("rate limited"))
	}))
	defer upstream.Close()

	proxy, err := newEngineProxy(strings.TrimPrefix(upstream.URL, "http://"))
	if err != nil {
		t.Fatalf("newEngineProxy() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, upstream.URL+"/ajax/bulk-route-definitions/", nil)
	request.Host = "celestial-bot.work.gd:8099"
	request.Header.Set("Cookie", "norav_auth=secret; ig_did=upstream-session; norav_sid=secret")
	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, request)

	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusTooManyRequests)
	}
	if got := response.Header().Get("Retry-After"); got != "30" {
		t.Errorf("Retry-After = %q, want 30", got)
	}
	if got := response.Header().Get("Origin-Agent-Cluster"); got != "?0" {
		t.Errorf("Origin-Agent-Cluster = %q, want ?0", got)
	}
	for _, name := range []string{"Cross-Origin-Opener-Policy", "Strict-Transport-Security", "Alt-Svc"} {
		if got := response.Header().Get(name); got != "" {
			t.Errorf("%s = %q, want removed", name, got)
		}
	}
}
