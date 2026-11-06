package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestValidateTargetURLRejectsPrivateDestinations(t *testing.T) {
	cases := []string{
		"http://127.0.0.1/",
		"http://10.1.2.3/",
		"http://192.168.1.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://[fe80::1]/",
		"http://localhost/",
		"http://router.local/",
		"http://service.internal/",
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			target, err := url.Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			if validateTargetURL(target) == nil {
				t.Fatalf("expected private destination to be rejected: %s", raw)
			}
		})
	}
}

func TestValidateTargetURLAcceptsPublicHTTP(t *testing.T) {
	for _, raw := range []string{"https://example.com/", "http://1.1.1.1/", "https://[2606:4700:4700::1111]/"} {
		target, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateTargetURL(target); err != nil {
			t.Fatalf("expected public destination to pass (%s): %v", raw, err)
		}
	}
}

func TestProxiedURLResolvesRelativeAssets(t *testing.T) {
	base, _ := url.Parse("https://assets.example.test/page/index.html")
	got := proxiedURL("../images/logo.svg", base)
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	target, err := url.Parse(parsed.Query().Get("url"))
	if err != nil {
		t.Fatal(err)
	}
	if target.String() != "https://assets.example.test/images/logo.svg" {
		t.Fatalf("unexpected rewritten URL: %s", target)
	}
	if proxiedURL("data:image/png;base64,AAAA", base) != "" {
		t.Fatal("data URLs must stay inline")
	}
}

func TestRewriteHTMLPreservesAndRewritesResources(t *testing.T) {
	base, _ := url.Parse("https://example.test/docs/")
	a := &app{}
	input := []byte(`<html><head><title>Test</title></head><body>
<a href="/next">next</a><img src="../logo.svg" integrity="sha256-test">
<link rel="stylesheet" href="/site.css"><video poster="/poster.webp"></video>
</body></html>`)
	output, err := a.rewriteHTML(input, base)
	if err != nil {
		t.Fatal(err)
	}
	text := string(output)
	for _, expected := range []string{"/proxy?url=", "https%3A%2F%2Fexample.test", "__NORAV_ORIGINAL_URL__", "norav:navigation", "next"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected rewritten HTML to contain %q", expected)
		}
	}
	if strings.Contains(text, "integrity=") {
		t.Fatal("integrity must be removed after URL rewriting")
	}
}

func TestSafeDialerRejectsPrivateIPBeforeDial(t *testing.T) {
	dialer := &safeDialer{timeout: time.Second}
	_, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:80")
	if err == nil {
		t.Fatal("private address must be rejected before dialing")
	}
}

func TestObservabilityCorrelatesRequestsAndClientIP(t *testing.T) {
	a := &app{obs: newObservability()}
	handler := a.instrument(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))
	req := httptest.NewRequest(http.MethodPost, "/proxy?url=https%3A%2F%2Fexample.com", strings.NewReader("payload"))
	req.RemoteAddr = "8.8.8.8:43321"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Header().Get("X-Request-ID") == "" || recorder.Header().Get("traceparent") == "" {
		t.Fatal("request correlation headers were not returned")
	}
	snapshot := a.obs.snapshot()
	if snapshot["requests"].(uint64) != 1 || snapshot["errors"].(uint64) != 0 {
		t.Fatalf("unexpected request counters: %#v", snapshot)
	}
	ips := snapshot["topIPs"].([]ipStats)
	if len(ips) != 1 || ips[0].IP != "8.8.8.8" || ips[0].Requests != 1 {
		t.Fatalf("client IP was not recorded: %#v", ips)
	}
}

func TestProxyOptionsRejectForeignHostAndAcceptSameHostOrigins(t *testing.T) {
	a := &app{cfg: config{uiAddr: "0.0.0.0:7845", proxyAddr: "0.0.0.0:7846"}}
	for _, tc := range []struct {
		name       string
		origin     string
		wantStatus int
	}{
		{name: "proxy origin", origin: "http://127.0.0.1:7846", wantStatus: http.StatusNoContent},
		{name: "dashboard origin", origin: "http://127.0.0.1:7845", wantStatus: http.StatusNoContent},
		{name: "foreign host on dashboard port", origin: "http://evil.example:7845", wantStatus: http.StatusForbidden},
		{name: "opaque origin", origin: "null", wantStatus: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, "http://127.0.0.1:7846/proxy", nil)
			req.Header.Set("Origin", tc.origin)
			recorder := httptest.NewRecorder()
			a.handleProxyOptions(recorder, req)
			if recorder.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.wantStatus)
			}
		})
	}
}

func TestIPConcurrencyLimiterCapsAndReleases(t *testing.T) {
	limiter := newIPConcurrencyLimiter(2)
	if !limiter.acquire("203.0.113.10") || !limiter.acquire("203.0.113.10") {
		t.Fatal("the first two requests should be admitted")
	}
	if limiter.acquire("203.0.113.10") {
		t.Fatal("the third concurrent request should be rejected")
	}
	if !limiter.acquire("203.0.113.11") {
		t.Fatal("another client IP should have an independent limit")
	}
	limiter.release("203.0.113.10")
	if !limiter.acquire("203.0.113.10") {
		t.Fatal("a released slot should admit another request")
	}
}

func TestLoginLimiterRefillsTokens(t *testing.T) {
	limiter := newLoginLimiter()
	for i := 0; i < 6; i++ {
		if !limiter.allow("203.0.113.12") {
			t.Fatalf("request %d should be admitted", i+1)
		}
	}
	if limiter.allow("203.0.113.12") {
		t.Fatal("the seventh immediate request should be rejected")
	}
	limiter.mu.Lock()
	bucket := limiter.buckets["203.0.113.12"]
	bucket.last = time.Now().Add(-20 * time.Second)
	limiter.buckets["203.0.113.12"] = bucket
	limiter.mu.Unlock()
	if !limiter.allow("203.0.113.12") {
		t.Fatal("the token bucket should refill over time")
	}
}

func TestLoadServerTLSRequiresPair(t *testing.T) {
	if _, err := loadServerTLS(config{tlsCertFile: "/tmp/cert.pem"}); err == nil {
		t.Fatal("a certificate without a key must be rejected")
	}
	if cfg, err := loadServerTLS(config{}); err != nil || cfg != nil {
		t.Fatalf("empty TLS configuration should use HTTP: config=%v err=%v", cfg, err)
	}
}
