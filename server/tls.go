package main

import (
	"crypto/tls"
	"errors"
	"net"
)

func loadServerTLS(cfg config) (*tls.Config, error) {
	if cfg.tlsCertFile == "" && cfg.tlsKeyFile == "" {
		return nil, nil
	}
	if cfg.tlsCertFile == "" || cfg.tlsKeyFile == "" {
		return nil, errors.New("both TLS certificate and key paths are required")
	}
	pair, err := tls.LoadX509KeyPair(cfg.tlsCertFile, cfg.tlsKeyFile)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{pair},
		NextProtos:   []string{"http/1.1"},
	}, nil
}

func withServerTLS(listener net.Listener, config *tls.Config) net.Listener {
	if config == nil {
		return listener
	}
	return tls.NewListener(listener, config.Clone())
}
