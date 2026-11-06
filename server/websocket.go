package main

import (
	"github.com/gorilla/websocket"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (a *app) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.requireSession(w, r)
	if !ok {
		return
	}
	target, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || !target.IsAbs() || (target.Scheme != "ws" && target.Scheme != "wss") {
		http.Error(w, "Invalid WebSocket destination.", 400)
		return
	}
	httpTarget := *target
	if httpTarget.Scheme == "wss" {
		httpTarget.Scheme = "https"
	} else {
		httpTarget.Scheme = "http"
	}
	if err := validateTargetURL(&httpTarget); err != nil {
		http.Error(w, "This WebSocket destination is not available through NoRav.", 403)
		return
	}
	origin, err := url.Parse(r.URL.Query().Get("origin"))
	if err != nil || !origin.IsAbs() || (origin.Scheme != "http" && origin.Scheme != "https") {
		http.Error(w, "Invalid WebSocket origin.", 400)
		return
	}
	headers := http.Header{}
	headers.Set("Origin", origin.Scheme+"://"+origin.Host)
	headers.Set("User-Agent", r.UserAgent())
	if cookies := sess.jar.Cookies(&httpTarget); len(cookies) > 0 {
		values := make([]string, 0, len(cookies))
		for _, cookie := range cookies {
			values = append(values, cookie.String())
		}
		headers.Set("Cookie", strings.Join(values, "; "))
	}
	if protocols := websocket.Subprotocols(r); len(protocols) > 0 {
		headers.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
	}
	dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second, Proxy: nil, NetDialContext: (&safeDialer{timeout: 12 * time.Second}).DialContext}
	upstream, response, err := dialer.DialContext(r.Context(), target.String(), headers)
	if err != nil {
		status := 502
		if response != nil {
			status = response.StatusCode
		}
		http.Error(w, "The WebSocket destination could not be reached.", status)
		return
	}
	defer upstream.Close()
	client, err := a.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	errCh := make(chan error, 2)
	go func() {
		for {
			kind, message, e := client.ReadMessage()
			if e != nil {
				errCh <- e
				return
			}
			if e = upstream.WriteMessage(kind, message); e != nil {
				errCh <- e
				return
			}
		}
	}()
	go func() {
		for {
			kind, message, e := upstream.ReadMessage()
			if e != nil {
				errCh <- e
				return
			}
			if e = client.WriteMessage(kind, message); e != nil {
				errCh <- e
				return
			}
		}
	}()
	<-errCh
}
