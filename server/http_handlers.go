package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func dashboardHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func (a *app) staticHandler() http.Handler {
	files := http.FileServer(http.Dir(a.cfg.webRoot))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean("/" + r.URL.Path)
		if strings.Contains(clean, "..") {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(a.cfg.webRoot, filepath.FromSlash(strings.TrimPrefix(clean, "/")))
		if clean == "/" {
			path = filepath.Join(a.cfg.webRoot, "index.html")
		}
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) && !strings.HasPrefix(r.URL.Path, "/assets/") {
				r.URL.Path = "/"
			} else if os.IsNotExist(err) {
				http.NotFound(w, r)
				return
			} else {
				http.Error(w, "Unable to read frontend asset.", 500)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "service": "norav", "version": version})
}
