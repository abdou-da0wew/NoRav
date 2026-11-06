package main

import (
	"net/http/httptest"
	"testing"
)

func TestUpstreamHostFromEnginePath(t *testing.T) {
	req := httptest.NewRequest("GET", "/engine-id/https://www.instagram.com/ajax/bulk-route-definitions/?q=1", nil)
	if got := upstreamHost(req); got != "www.instagram.com" {
		t.Fatalf("upstreamHost() = %q, want www.instagram.com", got)
	}
}

func TestUpstreamHostPrefersExplicitTarget(t *testing.T) {
	req := httptest.NewRequest("GET", "/engine-id/https://fallback.example/", nil)
	req.URL.RawQuery = "url=https%3A%2F%2Fexample.com%2Fpath"
	if got := upstreamHost(req); got != "example.com" {
		t.Fatalf("upstreamHost() = %q, want example.com", got)
	}
}

func TestUpstreamHostRejectsInvalidEnginePath(t *testing.T) {
	req := httptest.NewRequest("GET", "/engine-id/hammerhead.js", nil)
	if got := upstreamHost(req); got != "" {
		t.Fatalf("upstreamHost() = %q, want empty", got)
	}
}
