package main

import "testing"

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
