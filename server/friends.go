package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type friendSecurityState struct {
	PinHash       string   `json:"pinHash"`
	BannedIPs     []string `json:"bannedIPs"`
	BannedDevices []string `json:"bannedDevices"`
}

type sessionView struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"userAgent"`
	CreatedAt time.Time `json:"createdAt"`
	LastSeen  time.Time `json:"lastSeen"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (a *app) securityFile() string { return filepath.Join("data", "friend-access.json") }

func (a *app) loadFriendSecurity() error {
	if err := os.MkdirAll("data", 0700); err != nil {
		return err
	}
	state := friendSecurityState{}
	data, err := os.ReadFile(a.securityFile())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil {
		if err := json.Unmarshal(data, &state); err != nil {
			return err
		}
	}
	a.friendPinHash = nil
	if state.PinHash != "" {
		decoded, err := hex.DecodeString(state.PinHash)
		if err != nil {
			return err
		}
		a.friendPinHash = decoded
	}
	a.bannedIPs = make(map[string]bool)
	for _, ip := range state.BannedIPs {
		a.bannedIPs[ip] = true
	}
	a.bannedDevices = make(map[string]bool)
	for _, device := range state.BannedDevices {
		a.bannedDevices[device] = true
	}
	return nil
}

func (a *app) saveFriendSecurityLocked() error {
	state := friendSecurityState{}
	if len(a.friendPinHash) > 0 {
		state.PinHash = hex.EncodeToString(a.friendPinHash)
	}
	for ip := range a.bannedIPs {
		state.BannedIPs = append(state.BannedIPs, ip)
	}
	for device := range a.bannedDevices {
		state.BannedDevices = append(state.BannedDevices, device)
	}
	sort.Strings(state.BannedIPs)
	sort.Strings(state.BannedDevices)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp := a.securityFile() + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, a.securityFile())
}

func (a *app) hashFriendPIN(pin string) []byte {
	mac := hmac.New(sha256.New, a.cfg.cookieKey)
	_, _ = mac.Write([]byte("norav-friend-pin:" + pin))
	return mac.Sum(nil)
}

func (a *app) handleFriendLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", 403)
		return
	}
	if !a.loginLimiter.allow(a.clientIP(r)) {
		w.Header().Set("Retry-After", "10")
		http.Error(w, "Too many unlock attempts. Try again shortly.", 429)
		return
	}
	var input struct {
		PIN string `json:"pin"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Invalid request."})
		return
	}
	if len(input.PIN) < 4 || len(input.PIN) > 12 {
		writeJSON(w, 401, map[string]any{"error": "That friend PIN is not correct."})
		return
	}
	candidate := a.hashFriendPIN(input.PIN)
	a.mu.Lock()
	valid := len(a.friendPinHash) == len(candidate) && hmac.Equal(candidate, a.friendPinHash)
	ip := a.clientIP(r)
	deviceID := ""
	if cookie, err := r.Cookie("norav_device"); err == nil {
		deviceID = cookie.Value
	}
	deviceHash := ""
	if deviceID != "" {
		sum := sha256.Sum256([]byte(deviceID))
		deviceHash = hex.EncodeToString(sum[:])
	}
	blocked := a.bannedIPs[ip] || (deviceHash != "" && a.bannedDevices[deviceHash])
	a.mu.Unlock()
	if !valid || blocked {
		writeJSON(w, 401, map[string]any{"error": "That friend PIN is not correct."})
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
	deviceID = a.ensureDeviceID(w, r)
	expires := time.Now().Add(sessionLifetime)
	a.putSessionDetails(sid, refresh, expires, "friend", r, deviceID)
	a.setSessionCookies(w, sid, refresh, expires)
	writeJSON(w, 200, map[string]any{"authenticated": true, "role": "friend", "expiresAt": expires.UTC().Format(time.RFC3339)})
}

func (a *app) requireOwner(w http.ResponseWriter, r *http.Request) (*session, bool) {
	s, ok := a.requireSession(w, r)
	if !ok {
		return nil, false
	}
	if s.role != "owner" {
		http.Error(w, "owner access required", http.StatusForbidden)
		return nil, false
	}
	return s, true
}

func (a *app) handleAdminFriends(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireOwner(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	items := make([]sessionView, 0, len(a.sessions))
	for id, s := range a.sessions {
		if time.Now().After(s.expiresAt) {
			continue
		}
		items = append(items, sessionView{ID: id, Role: s.role, IP: s.ip, UserAgent: s.userAgent, CreatedAt: s.createdAt, LastSeen: s.lastSeen, ExpiresAt: s.expiresAt})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].LastSeen.After(items[j].LastSeen) })
	writeJSON(w, 200, map[string]any{"pinEnabled": len(a.friendPinHash) > 0, "sessions": items})
}

func (a *app) handleAdminFriendPIN(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if _, ok := a.requireOwner(w, r); !ok {
		return
	}
	if r.Method != http.MethodPut {
		http.Error(w, "method not allowed", 405)
		return
	}
	var input struct {
		PIN     string `json:"pin"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Invalid request."})
		return
	}
	if input.Enabled && (len(input.PIN) < 4 || len(input.PIN) > 12 || strings.Trim(input.PIN, "0123456789") != "") {
		writeJSON(w, 400, map[string]any{"error": "Use a PIN containing 4 to 12 digits."})
		return
	}
	a.mu.Lock()
	if input.Enabled {
		a.friendPinHash = a.hashFriendPIN(input.PIN)
	} else {
		a.friendPinHash = nil
		for id, sess := range a.sessions {
			if sess.role == "friend" {
				delete(a.sessions, id)
			}
		}
	}
	err := a.saveFriendSecurityLocked()
	a.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not save friend access settings."})
		return
	}
	writeJSON(w, 200, map[string]any{"pinEnabled": input.Enabled})
}

func (a *app) handleAdminSessionAction(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if _, ok := a.requireOwner(w, r); !ok {
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", 405)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 {
		http.NotFound(w, r)
		return
	}
	id, action := parts[3], parts[4]
	a.mu.Lock()
	s := a.sessions[id]
	if s == nil {
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	switch action {
	case "revoke", "kick":
		delete(a.sessions, id)
	case "ban-ip":
		if s.ip != "" {
			a.bannedIPs[s.ip] = true
		}
		for sid, other := range a.sessions {
			if other.ip == s.ip {
				delete(a.sessions, sid)
			}
		}
	case "ban-device":
		if s.deviceHash != "" {
			a.bannedDevices[s.deviceHash] = true
		}
		for sid, other := range a.sessions {
			if other.deviceHash == s.deviceHash {
				delete(a.sessions, sid)
			}
		}
	default:
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	err := a.saveFriendSecurityLocked()
	a.mu.Unlock()
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not save the session action."})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
