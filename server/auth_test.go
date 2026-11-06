package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRefreshTokenRotationExtendsActiveSession(t *testing.T) {
	a := &app{sessions: make(map[string]*session)}
	now := time.Now()
	oldRefresh := "old-refresh-token"
	nextRefresh := "new-refresh-token"
	a.putSession("session-id", oldRefresh, now.Add(2*time.Hour))

	expires, ok := a.rotateSession("session-id", oldRefresh, nextRefresh)
	if !ok {
		t.Fatal("valid refresh token should rotate")
	}
	if time.Until(expires) < 29*24*time.Hour {
		t.Fatalf("session expiry was not extended to 30 days: %s", time.Until(expires))
	}
	if _, ok := a.rotateSession("session-id", oldRefresh, "replay"); ok {
		t.Fatal("a rotated refresh token must not be reusable")
	}
	if _, ok := a.rotateSession("session-id", nextRefresh, "third-refresh-token"); !ok {
		t.Fatal("new refresh token should be accepted")
	}
}

func TestRefreshTokenCannotReviveExpiredSession(t *testing.T) {
	a := &app{sessions: make(map[string]*session)}
	a.putSession("expired-session", "refresh", time.Now().Add(-time.Minute))
	if _, ok := a.rotateSession("expired-session", "refresh", "next"); ok {
		t.Fatal("expired session must not be refreshed")
	}
}

func TestFriendPINLoginCreatesFriendRoleSession(t *testing.T) {
	a := &app{
		cfg:           config{cookieKey: []byte("test-cookie-signing-key"), secureCookie: false},
		sessions:      make(map[string]*session),
		loginLimiter:  newLoginLimiter(),
		bannedIPs:     make(map[string]bool),
		bannedDevices: make(map[string]bool),
	}
	a.friendPinHash = a.hashFriendPIN("731946")
	request := httptest.NewRequest(http.MethodPost, "/api/auth/friend", strings.NewReader(`{"pin":"731946"}`))
	response := httptest.NewRecorder()
	a.handleFriendLogin(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected successful friend login, got %d: %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["role"] != "friend" || result["authenticated"] != true {
		t.Fatalf("unexpected friend login result: %#v", result)
	}
	var sessionID string
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == sessionCookie {
			sessionID = cookie.Value
		}
	}
	if sessionID == "" {
		t.Fatal("friend login did not issue a session cookie")
	}
	session := a.getSession(sessionID)
	if session == nil || session.role != "friend" {
		t.Fatal("friend login did not create a friend-scoped session")
	}
}

func TestFriendSessionCannotUseOwnerGuard(t *testing.T) {
	a := &app{cfg: config{cookieKey: []byte("test-cookie-signing-key")}, sessions: make(map[string]*session)}
	a.putSession("friend-session", "refresh-token", time.Now().Add(time.Hour))
	a.mu.Lock()
	a.sessions["friend-session"].role = "friend"
	a.mu.Unlock()
	request := httptest.NewRequest(http.MethodGet, "/api/admin/friends", nil)
	request.AddCookie(&http.Cookie{Name: authCookie, Value: a.signAuth(time.Now().Add(time.Hour))})
	request.AddCookie(&http.Cookie{Name: sessionCookie, Value: "friend-session"})
	response := httptest.NewRecorder()
	if _, ok := a.requireOwner(response, request); ok {
		t.Fatal("friend session must not pass the owner guard")
	}
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for friend session, got %d", response.Code)
	}
}

func TestOwnerLoginCreatesOwnerRoleSession(t *testing.T) {
	key := "test-owner-access-key-123456789"
	a := &app{
		cfg:          config{accessKey: []byte(key), cookieKey: []byte("test-cookie-signing-key"), secureCookie: false},
		sessions:     make(map[string]*session),
		loginLimiter: newLoginLimiter(),
	}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"accessKey":"test-owner-access-key-123456789"}`))
	response := httptest.NewRecorder()
	a.handleLogin(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected successful owner login, got %d: %s", response.Code, response.Body.String())
	}
	var sessionID string
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == sessionCookie {
			sessionID = cookie.Value
		}
	}
	if sessionID == "" {
		t.Fatal("owner login did not issue a session cookie")
	}
	session := a.getSession(sessionID)
	if session == nil || session.role != "owner" {
		t.Fatal("owner login did not create an owner-scoped session")
	}
}

func TestOwnerCanPersistAndDisableFriendPIN(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(previous) }()

	a := &app{
		cfg:      config{cookieKey: []byte("test-cookie-signing-key"), secureCookie: false},
		sessions: make(map[string]*session), loginLimiter: newLoginLimiter(),
		bannedIPs: make(map[string]bool), bannedDevices: make(map[string]bool),
	}
	if err := a.loadFriendSecurity(); err != nil {
		t.Fatal(err)
	}
	a.putSession("owner-session", "owner-refresh", time.Now().Add(time.Hour))
	ownerRequest := func(body string) *http.Request {
		r := httptest.NewRequest(http.MethodPut, "/api/admin/friend-pin", strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: authCookie, Value: a.signAuth(time.Now().Add(time.Hour))})
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: "owner-session"})
		return r
	}
	response := httptest.NewRecorder()
	a.handleAdminFriendPIN(response, ownerRequest(`{"pin":"731946","enabled":true}`))
	if response.Code != http.StatusOK {
		t.Fatalf("enable PIN failed: %d %s", response.Code, response.Body.String())
	}
	stored, err := os.ReadFile("data/friend-access.json")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stored), "731946") {
		t.Fatal("friend PIN was stored in plaintext")
	}

	friendRequest := httptest.NewRequest(http.MethodPost, "/api/auth/friend", strings.NewReader(`{"pin":"731946"}`))
	friendResponse := httptest.NewRecorder()
	a.handleFriendLogin(friendResponse, friendRequest)
	if friendResponse.Code != http.StatusOK {
		t.Fatalf("friend login failed: %d %s", friendResponse.Code, friendResponse.Body.String())
	}
	var friendID string
	for _, cookie := range friendResponse.Result().Cookies() {
		if cookie.Name == sessionCookie {
			friendID = cookie.Value
		}
	}
	if friendID == "" {
		t.Fatal("friend session cookie missing")
	}

	response = httptest.NewRecorder()
	a.handleAdminFriendPIN(response, ownerRequest(`{"enabled":false}`))
	if response.Code != http.StatusOK {
		t.Fatalf("disable PIN failed: %d %s", response.Code, response.Body.String())
	}
	if a.getSession(friendID) != nil {
		t.Fatal("disabling friend access must revoke active friend sessions")
	}
	if len(a.friendPinHash) != 0 {
		t.Fatal("friend PIN hash should be cleared when disabled")
	}
}
