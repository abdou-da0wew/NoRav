package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/brickingsoft/rio"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func requestedURL(r *http.Request) (*url.URL, error) {
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" {
		raw = strings.TrimSpace(r.Header.Get("X-NoRav-Target"))
	}
	if raw == "" {
		return nil, errors.New("No destination URL was supplied.")
	}
	target, err := url.Parse(raw)
	if err != nil || !target.IsAbs() {
		return nil, errors.New("Enter a complete website address.")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errors.New("Only HTTP and HTTPS destinations are supported.")
	}
	if target.User != nil {
		return nil, errors.New("Addresses containing credentials are not supported.")
	}
	return target, nil
}

func validateTargetURL(target *url.URL) error {
	if target == nil || !target.IsAbs() || target.Hostname() == "" {
		return errors.New("invalid destination")
	}
	if target.Scheme != "http" && target.Scheme != "https" && target.Scheme != "ws" && target.Scheme != "wss" {
		return errors.New("unsupported scheme")
	}
	if target.User != nil {
		return errors.New("userinfo is not supported")
	}
	port := target.Port()
	if port != "" && port != "80" && port != "443" && port != "8080" && port != "8443" {
		return errors.New("destination port is not allowed")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || host == "metadata.google.internal" || host == "host.docker.internal" {
		return errors.New("local hostnames are not allowed")
	}
	if ip, err := netip.ParseAddr(host); err == nil && !isPublicIP(ip) {
		return errors.New("non-public IP addresses are not allowed")
	}
	return nil
}

func isPublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	blocked := []netip.Prefix{netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001:db8::/32")}
	for _, p := range blocked {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

type safeDialer struct{ timeout time.Duration }

func (d *safeDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if port != "80" && port != "443" && port != "8080" && port != "8443" {
		return nil, errors.New("destination port is not allowed")
	}
	if ip, e := netip.ParseAddr(host); e == nil {
		if !isPublicIP(ip) {
			return nil, errors.New("destination IP is not public")
		}
		return d.dial(ctx, network, ip, port)
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("destination host did not resolve")
	}
	var last error
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return nil, errors.New("destination resolved to a non-public address")
		}
		conn, e := d.dial(ctx, network, ip, port)
		if e == nil {
			return conn, nil
		}
		last = e
	}
	if last == nil {
		last = errors.New("no destination address could be reached")
	}
	return nil, last
}

func (d *safeDialer) dial(ctx context.Context, network string, ip netip.Addr, port string) (net.Conn, error) {
	address := net.JoinHostPort(ip.String(), port)
	if ioUringDialActive.Load() {
		conn, err := safeRIODial(ctx, network, address, d.timeout)
		if err == nil {
			return conn, nil
		}
		if !isRingUnavailable(err) {
			return nil, err
		}
		slog.Warn("io_uring_dial_fallback", "address", address, "error", err.Error())
		if ioUringStrict {
			return nil, err
		}
		ioUringDialActive.Store(false)
	}
	return (&net.Dialer{Timeout: d.timeout, KeepAlive: 30 * time.Second}).DialContext(ctx, network, address)
}

func createListener(address string) (net.Listener, error) {
	if ioUringActive.Load() {
		listener, err := safeRIOListen(address)
		if err == nil {
			return listener, nil
		}
		if !isRingUnavailable(err) {
			return nil, err
		}
		slog.Warn("io_uring_listener_fallback", "address", address, "error", err.Error())
		if ioUringStrict {
			return nil, err
		}
		ioUringActive.Store(false)
		ioUringDialActive.Store(false)
	}
	return net.Listen("tcp", address)
}

func safeRIODial(ctx context.Context, network, address string, timeout time.Duration) (conn net.Conn, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("io_uring dial panic: %v", recovered)
			conn = nil
		}
	}()
	return (&rio.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}).DialContext(ctx, network, address)
}

func safeRIOListen(address string) (listener net.Listener, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("io_uring listener panic: %v", recovered)
			listener = nil
		}
	}()
	return rio.Listen("tcp", address)
}

func isRingUnavailable(err error) bool {
	return errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.ENOSYS) ||
		errors.Is(err, syscall.EOPNOTSUPP) || errors.Is(err, syscall.EINVAL)
}

func kernelRelease() string {
	data, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return runtime.GOOS + "/" + runtime.GOARCH
	}
	return strings.TrimSpace(string(data))
}

func copyRequestHeaders(dst, src http.Header) {
	for key, values := range src {
		h := http.CanonicalHeaderKey(key)
		switch h {
		case "Host", "Connection", "Proxy-Connection", "Proxy-Authenticate", "Proxy-Authorization", "Keep-Alive", "Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length", "Cookie", "X-Norav-Target", "X-Norav-Origin", "X-Norav-Referer":
			continue
		}
		if strings.HasPrefix(strings.ToLower(h), "sec-fetch-") || strings.HasPrefix(strings.ToLower(h), "access-control-") {
			continue
		}
		for _, v := range values {
			dst.Add(h, v)
		}
	}
}

func copyResponseHeaders(dst, src http.Header) {
	for key, values := range src {
		h := http.CanonicalHeaderKey(key)
		switch h {
		case "Connection", "Proxy-Authenticate", "Proxy-Authorization", "Keep-Alive", "Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length", "Set-Cookie", "Set-Cookie2", "Content-Security-Policy", "Content-Security-Policy-Report-Only", "X-Frame-Options", "Strict-Transport-Security", "Alt-Svc":
			continue
		}
		for _, v := range values {
			dst.Add(h, v)
		}
	}
	dst.Set("Referrer-Policy", "no-referrer-when-downgrade")
}

func allowedMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return true
	}
	return false
}
