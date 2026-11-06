package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if !a.loginLimiter.allow(a.clientIP(r)) {
		w.Header().Set("Retry-After", "10")
		http.Error(w, "Too many unlock attempts. Try again shortly.", http.StatusTooManyRequests)
		return
	}
	var input struct {
		AccessKey string `json:"accessKey"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Invalid request."})
		return
	}
	candidate := []byte(input.AccessKey)
	if len(candidate) != len(a.cfg.accessKey) || subtle.ConstantTimeCompare(candidate, a.cfg.accessKey) != 1 {
		writeJSON(w, 401, map[string]any{"error": "That access key is not correct."})
		return
	}
	sid, err := randomToken(32)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not start a session."})
		return
	}
	refresh, err := randomToken(32)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not start a session."})
		return
	}
	expires := time.Now().Add(sessionLifetime)
	deviceID := a.ensureDeviceID(w, r)
	a.putSessionDetails(sid, refresh, expires, "owner", r, deviceID)
	a.setSessionCookies(w, sid, refresh, expires)
	writeJSON(w, 200, map[string]any{"authenticated": true, "expiresAt": expires.UTC().Format(time.RFC3339)})
}

func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		a.deleteSession(cookie.Value)
	}
	for _, name := range []string{authCookie, sessionCookie, refreshCookie} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0), HttpOnly: true, Secure: a.cfg.secureCookie, SameSite: http.SameSiteStrictMode})
	}
	writeJSON(w, 200, map[string]any{"authenticated": false})
}

func (a *app) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	sid, sidErr := r.Cookie(sessionCookie)
	oldRefresh, refreshErr := r.Cookie(refreshCookie)
	if sidErr != nil || refreshErr != nil || sid.Value == "" || oldRefresh.Value == "" {
		writeJSON(w, 200, map[string]any{"authenticated": false})
		return
	}
	nextRefresh, err := randomToken(32)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not refresh the session."})
		return
	}
	expires, ok := a.rotateSession(sid.Value, oldRefresh.Value, nextRefresh)
	if !ok {
		writeJSON(w, 200, map[string]any{"authenticated": false})
		return
	}
	a.setSessionCookies(w, sid.Value, nextRefresh, expires)
	sess := a.getSession(sid.Value)
	role := "owner"
	if sess != nil && sess.role != "" {
		role = sess.role
	}
	writeJSON(w, 200, map[string]any{"authenticated": true, "role": role, "version": version, "expiresAt": expires.UTC().Format(time.RFC3339)})
}

func (a *app) setSessionCookies(w http.ResponseWriter, sid, refresh string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	set := func(name, value string) {
		http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Expires: expires, MaxAge: maxAge, HttpOnly: true, Secure: a.cfg.secureCookie, SameSite: http.SameSiteStrictMode})
	}
	set(authCookie, a.signAuth(expires))
	set(sessionCookie, sid)
	set(refreshCookie, refresh)
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

func (a *app) requireSession(w http.ResponseWriter, r *http.Request) (*session, bool) {
	if !a.isAuthenticated(r) {
		http.Error(w, "Unlock NoRav in the dashboard before browsing.", 401)
		return nil, false
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		http.Error(w, "NoRav session has expired. Unlock the dashboard again.", 401)
		return nil, false
	}
	s := a.getSession(c.Value)
	if s == nil {
		http.Error(w, "NoRav session has expired. Unlock the dashboard again.", 401)
		return nil, false
	}
	return s, true
}

func (a *app) isAuthenticated(r *http.Request) bool {
	c, err := r.Cookie(authCookie)
	if err != nil {
		return false
	}
	p := strings.Split(c.Value, ".")
	if len(p) != 2 {
		return false
	}
	exp, err := strconv.ParseInt(p[0], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	mac := hmac.New(sha256.New, a.cfg.cookieKey)
	_, _ = mac.Write([]byte(p[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(p[1]))
}

func (a *app) signAuth(exp time.Time) string {
	stamp := strconv.FormatInt(exp.Unix(), 10)
	mac := hmac.New(sha256.New, a.cfg.cookieKey)
	_, _ = mac.Write([]byte(stamp))
	return stamp + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *app) putSession(id, refresh string, expires time.Time) {
	jar, _ := cookiejar.New(nil)
	a.mu.Lock()
	now := time.Now()
	a.sessions[id] = &session{jar: jar, lastSeen: now, createdAt: now, expiresAt: expires, refreshHash: sha256.Sum256([]byte(refresh)), role: "owner"}
	a.mu.Unlock()
}

func (a *app) putSessionDetails(id, refresh string, expires time.Time, role string, r *http.Request, deviceID string) {
	jar, _ := cookiejar.New(nil)
	now := time.Now()
	ip := a.clientIP(r)
	deviceHash := ""
	if deviceID != "" {
		sum := sha256.Sum256([]byte(deviceID))
		deviceHash = fmt.Sprintf("%x", sum[:])
	}
	a.mu.Lock()
	a.sessions[id] = &session{jar: jar, lastSeen: now, createdAt: now, expiresAt: expires, refreshHash: sha256.Sum256([]byte(refresh)), role: role, ip: ip, userAgent: r.UserAgent(), deviceHash: deviceHash}
	a.mu.Unlock()
}

func (a *app) ensureDeviceID(w http.ResponseWriter, r *http.Request) string {
	if cookie, err := r.Cookie("norav_device"); err == nil && len(cookie.Value) >= 32 {
		return cookie.Value
	}
	value, err := randomToken(32)
	if err != nil {
		return ""
	}
	http.SetCookie(w, &http.Cookie{Name: "norav_device", Value: value, Path: "/", MaxAge: 365 * 24 * 60 * 60, Expires: time.Now().Add(365 * 24 * time.Hour), HttpOnly: true, Secure: a.cfg.secureCookie, SameSite: http.SameSiteStrictMode})
	return value
}

func (a *app) getSession(id string) *session {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.sessions[id]
	if s == nil || time.Now().After(s.expiresAt) {
		delete(a.sessions, id)
		return nil
	}
	s.lastSeen = time.Now()
	return s
}

func (a *app) rotateSession(id, currentRefresh, nextRefresh string) (time.Time, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.sessions[id]
	if s == nil || time.Now().After(s.expiresAt) {
		delete(a.sessions, id)
		return time.Time{}, false
	}
	candidate := sha256.Sum256([]byte(currentRefresh))
	if !hmac.Equal(candidate[:], s.refreshHash[:]) {
		return time.Time{}, false
	}
	expires := time.Now().Add(sessionLifetime)
	s.refreshHash = sha256.Sum256([]byte(nextRefresh))
	s.expiresAt = expires
	s.lastSeen = time.Now()
	return expires, true
}

func (a *app) deleteSession(id string) { a.mu.Lock(); delete(a.sessions, id); a.mu.Unlock() }

func randomToken(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func portOf(addr string) string {
	_, p, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return p
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
