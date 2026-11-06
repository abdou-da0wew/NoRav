package main

import (
	"context"
	"errors"
	"github.com/gorilla/websocket"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/brickingsoft/rio/pkg/liburing/aio"
)

var ioUringActive atomic.Bool
var ioUringDialActive atomic.Bool
var ioUringPinned atomic.Bool
var ioUringStrict bool

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	tlsConfig, err := loadServerTLS(cfg)
	if err != nil {
		log.Fatal(err)
	}
	mode := strings.ToLower(envOr("NORAV_IO_URING", "auto"))
	if mode != "off" {
		ioUringStrict = mode == "on"
		aio.Preset(aio.WithEntries(16384), aio.WithWaitCQETimeoutCurve(aio.SCurve), aio.WithMultishotDisabled(true))
		if pinErr := aio.Pin(); pinErr != nil {
			slog.Warn("io_uring_unavailable", "error", pinErr.Error())
			if ioUringStrict {
				log.Fatalf("io_uring required but unavailable: %v", pinErr)
			}
		} else {
			ioUringPinned.Store(true)
			ioUringActive.Store(true)
			ioUringDialActive.Store(true)
		}
	}
	dialer := &safeDialer{timeout: 12 * time.Second}
	transport := &http.Transport{
		Proxy: nil, DialContext: dialer.DialContext, ForceAttemptHTTP2: true,
		MaxIdleConns: 160, MaxIdleConnsPerHost: 12, MaxConnsPerHost: 20,
		IdleConnTimeout: 75 * time.Second, TLSHandshakeTimeout: 12 * time.Second,
		ResponseHeaderTimeout: 35 * time.Second, ExpectContinueTimeout: time.Second,
	}
	a := &app{
		cfg: cfg, transport: transport, sessions: make(map[string]*session), obs: newObservability(), loginLimiter: newLoginLimiter(), requestLimiter: newIPConcurrencyLimiter(64), bannedIPs: make(map[string]bool), bannedDevices: make(map[string]bool),
		trustedProxies: parseTrustedProxies(os.Getenv("NORAV_TRUSTED_PROXIES")),
		upgrader:       websocket.Upgrader{ReadBufferSize: 16 * 1024, WriteBufferSize: 16 * 1024, CheckOrigin: nil},
	}
	uiMux := http.NewServeMux()
	uiMux.HandleFunc("/api/auth/login", a.handleLogin)
	uiMux.HandleFunc("/api/auth/friend", a.handleFriendLogin)
	uiMux.HandleFunc("/api/admin/friends", a.handleAdminFriends)
	uiMux.HandleFunc("/api/admin/friend-pin", a.handleAdminFriendPIN)
	uiMux.HandleFunc("/api/admin/sessions/", a.handleAdminSessionAction)
	uiMux.HandleFunc("/api/auth/logout", a.handleLogout)
	uiMux.HandleFunc("/api/auth/session", a.handleAuthSession)
	uiMux.HandleFunc("/api/health", a.handleHealth)
	uiMux.HandleFunc("/api/analytics", a.handleAnalytics)
	uiMux.HandleFunc("/api/metrics", a.handleMetrics)
	uiMux.HandleFunc("/api/proxy/session", a.handleProxySession)
	if err := a.loadFriendSecurity(); err != nil {
		log.Fatalf("load friend access settings: %v", err)
	}
	uiMux.Handle("/", a.staticHandler())
	engineProxy, err := newEngineProxy(cfg.engineProxyAddr)
	if err != nil {
		log.Fatalf("configure proxy engine gateway: %v", err)
	}
	a.engineProxy = engineProxy

	uiServer := &http.Server{Addr: cfg.uiAddr, Handler: securityHeaders(dashboardHeaders(a.instrument(uiMux))), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	proxyServer := &http.Server{Addr: cfg.proxyAddr, Handler: a.instrument(http.HandlerFunc(a.handleEngineProxy)), ReadHeaderTimeout: 15 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 1 << 20}
	uiListener, err := createListener(cfg.uiAddr)
	if err != nil {
		aio.Unpin()
		log.Fatalf("dashboard listener failed: %v", err)
	}
	proxyListener, err := createListener(cfg.proxyAddr)
	if err != nil {
		_ = uiListener.Close()
		aio.Unpin()
		log.Fatalf("proxy listener failed: %v", err)
	}
	ioMode := "epoll"
	if ioUringActive.Load() {
		ioMode = "io_uring"
	}
	transportMode := "http"
	if tlsConfig != nil {
		transportMode = "https"
	}
	slog.Info("norav_runtime_ready", "io_backend", ioMode, "transport", transportMode, "kernel", kernelRelease(), "ui_addr", cfg.uiAddr, "proxy_addr", cfg.proxyAddr)
	errCh := make(chan error, 2)
	go func() { errCh <- uiServer.Serve(withServerTLS(uiListener, tlsConfig)) }()
	go func() { errCh <- proxyServer.Serve(withServerTLS(proxyListener, tlsConfig)) }()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-stop:
		log.Printf("received %s, shutting down", sig)
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server stopped: %v", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = uiServer.Shutdown(ctx)
	_ = proxyServer.Shutdown(ctx)
	transport.CloseIdleConnections()
	if ioUringPinned.Swap(false) {
		aio.Unpin()
	}
}
