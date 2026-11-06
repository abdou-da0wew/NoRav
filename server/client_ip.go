package main

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func (a *app) clientIP(r *http.Request) string {
	remote := remoteIP(r.RemoteAddr)
	if !remote.IsValid() {
		return "unknown"
	}
	if !a.isTrustedProxy(remote) {
		return remote.String()
	}
	values := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(values) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(values[i])
		ip, err := netip.ParseAddr(candidate)
		if err != nil {
			continue
		}
		if !a.isTrustedProxy(ip) {
			return ip.String()
		}
	}
	if realIP, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
		return realIP.String()
	}
	return remote.String()
}

func remoteIP(address string) netip.Addr {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	ip, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return netip.Addr{}
	}
	return ip.Unmap()
}

func (a *app) isTrustedProxy(ip netip.Addr) bool {
	for _, prefix := range a.trustedProxies {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

func parseTrustedProxies(raw string) []netip.Prefix {
	var output []netip.Prefix
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if strings.Contains(value, "/") {
			if prefix, err := netip.ParsePrefix(value); err == nil {
				output = append(output, prefix.Masked())
			}
			continue
		}
		if ip, err := netip.ParseAddr(value); err == nil {
			output = append(output, netip.PrefixFrom(ip, ip.BitLen()))
		}
	}
	return output
}
