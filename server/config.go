package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	version         = "0.1.0"
	maxBodyBytes    = 32 << 20
	maxHTMLBytes    = 16 << 20
	maxTextBytes    = 12 << 20
	authCookie      = "norav_auth"
	sessionCookie   = "norav_sid"
	refreshCookie   = "norav_refresh"
	sessionLifetime = 30 * 24 * time.Hour
)

type config struct {
	uiAddr            string
	proxyAddr         string
	webRoot           string
	accessKey         []byte
	cookieKey         []byte
	secureCookie      bool
	metricsToken      string
	tlsCertFile       string
	tlsKeyFile        string
	engineProxyAddr   string
	engineControlAddr string
}

type session struct {
	jar         http.CookieJar
	lastSeen    time.Time
	createdAt   time.Time
	expiresAt   time.Time
	refreshHash [32]byte
	role        string
	ip          string
	userAgent   string
	deviceHash  string
	engineID    string
}

type app struct {
	cfg            config
	transport      *http.Transport
	sessions       map[string]*session
	mu             sync.Mutex
	upgrader       websocket.Upgrader
	obs            observability
	trustedProxies []netip.Prefix
	loginLimiter   *loginRateLimiter
	requestLimiter *ipConcurrencyLimiter
	friendPinHash  []byte
	bannedIPs      map[string]bool
	bannedDevices  map[string]bool
	engineProxy    *httputil.ReverseProxy
}

func loadConfig() (config, error) {
	key := strings.TrimSpace(os.Getenv("NORAV_ACCESS_KEY"))
	if key == "" {
		keyPath := os.Getenv("NORAV_ACCESS_KEY_FILE")
		if keyPath == "" {
			keyPath = "./data/access.key"
		}
		if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
			return config{}, fmt.Errorf("create key directory: %w", err)
		}
		if err := os.Chmod(filepath.Dir(keyPath), 0700); err != nil {
			return config{}, fmt.Errorf("secure key directory: %w", err)
		}
		if existing, err := os.ReadFile(keyPath); err == nil {
			key = strings.TrimSpace(string(existing))
		} else if !os.IsNotExist(err) {
			return config{}, fmt.Errorf("read access key: %w", err)
		} else {
			raw := make([]byte, 24)
			if _, err := rand.Read(raw); err != nil {
				return config{}, fmt.Errorf("generate access key: %w", err)
			}
			key = base64.RawURLEncoding.EncodeToString(raw)
			if err := os.WriteFile(keyPath, []byte(key+"\n"), 0600); err != nil {
				return config{}, fmt.Errorf("save access key: %w", err)
			}
			log.Printf("generated first-run access key at %s", keyPath)
		}
	}
	if len(key) < 20 {
		return config{}, errors.New("NORAV_ACCESS_KEY must contain at least 20 characters")
	}
	cookieKey := sha256.Sum256([]byte("norav-cookie-signing:" + key))
	tlsCert := strings.TrimSpace(os.Getenv("NORAV_TLS_CERT_FILE"))
	tlsKey := strings.TrimSpace(os.Getenv("NORAV_TLS_KEY_FILE"))
	if (tlsCert == "") != (tlsKey == "") {
		return config{}, errors.New("NORAV_TLS_CERT_FILE and NORAV_TLS_KEY_FILE must be configured together")
	}
	return config{
		uiAddr: envOr("NORAV_UI_ADDR", "0.0.0.0:7845"), proxyAddr: envOr("NORAV_PROXY_ADDR", "0.0.0.0:7846"),
		webRoot: envOr("NORAV_WEB_ROOT", "./dist"), accessKey: []byte(key), cookieKey: cookieKey[:],
		secureCookie: tlsCert != "" || strings.EqualFold(os.Getenv("NORAV_SECURE_COOKIE"), "true"),
		metricsToken: strings.TrimSpace(os.Getenv("NORAV_METRICS_TOKEN")),
		tlsCertFile:  tlsCert, tlsKeyFile: tlsKey,
		engineProxyAddr:   envOr("NORAV_ENGINE_PROXY_ADDR", "127.0.0.1:17860"),
		engineControlAddr: envOr("NORAV_ENGINE_CONTROL_ADDR", "127.0.0.1:17862"),
	}, nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
