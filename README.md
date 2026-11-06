# NoRav

NoRav is a self-hosted, browser-style web proxy. The dashboard is a React 19 + Vite app. A Go service handles authentication, session policy, TLS, and the public HTTP gateway; a separate TypeScript/Node.js sidecar uses TestCafe Hammerhead to rewrite destination pages and browser requests. The VDS deployment exposes it through a trusted HTTPS hostname, with Nginx terminating TLS before the loopback-only Go gateway.

## Runtime addresses

The current VDS deployment uses two ports because the machine already has Nginx listening on ports 80 and 443:

- Dashboard: `https://celestial-bot.work.gd:7845`
- Proxied websites: `https://celestial-bot.work.gd:8099`

The dashboard and proxy use different browser origins. This keeps a website rendered in the proxy iframe from directly reading the NoRav dashboard's DOM or storage. Both ports share the same hostname, so the host-only HttpOnly session cookie can be sent to the proxy origin without exposing it to destination websites.

## Development and build

```bash
bun install --frozen-lockfile
bun run engine:check
bun run build

cd server
go test -race ./...
go vet ./...
go build -trimpath -ldflags='-s -w' -o ../norav .
```

The Vite development server is local-only at `127.0.0.1:5173`. The Go binary serves the production bundle from `./dist` by default. The engine source is TypeScript under `proxy-engine/src`, with strict compiler checks. Prettier owns formatting, Oxlint owns linting, and Biome is used only for import organization. Run `bun run engine:check` before building; it executes the import, format, type, lint, unit, and engine integration checks.

The proxy engine and Go gateway run as separate user-level systemd services. Install both units after building the frontend, Go binary, and TypeScript engine:

```bash
install -m 0644 deploy/norav-proxy-engine.service ~/.config/systemd/user/norav-proxy-engine.service
install -m 0644 deploy/norav.service ~/.config/systemd/user/norav.service
systemctl --user daemon-reload
systemctl --user enable --now norav-proxy-engine.service norav.service
sudo install -o root -g root -m 0644 deploy/norav-nginx.conf /etc/nginx/conf.d/norav.conf
sudo nginx -t && sudo systemctl reload nginx
journalctl --user -u norav-proxy-engine.service -u norav.service -f
```

The TypeScript engine and Go gateway bind only to loopback. Nginx terminates TLS on `7845` (dashboard) and `8099` (proxy), using the existing Let's Encrypt certificate for `celestial-bot.work.gd`. The public proxy origin in `norav-proxy-engine.service` must match the externally visible HTTPS proxy origin exactly. The Go service trusts forwarded host/protocol headers only from loopback and sets secure session cookies. The Go service connects to the engine's loopback proxy and control ports.

## Run

```bash
NORAV_UI_ADDR=127.0.0.1:17845 \
NORAV_PROXY_ADDR=127.0.0.1:17899 \
NORAV_PUBLIC_PROXY_PORT=8099 \
NORAV_SECURE_COOKIE=true \
NORAV_IO_URING=auto \
./norav
```

On first run, NoRav generates a 32-character URL-safe access key at `./data/access.key` with restrictive filesystem permissions. Read it on the server with:

```bash
cat data/access.key
```

Set `NORAV_ACCESS_KEY` to provide your own key, or `NORAV_ACCESS_KEY_FILE` to choose a different key file. Do not put the key in a public web page, source file, or command history.

## TLS

For a direct Go TLS deployment (without Nginx), the Go server supports a certificate and private key on both listeners:

```bash
NORAV_TLS_CERT_FILE=/path/to/fullchain.pem \
NORAV_TLS_KEY_FILE=/path/to/privkey.pem \
NORAV_UI_ADDR=127.0.0.1:17845 \
NORAV_PROXY_ADDR=127.0.0.1:17899 \
NORAV_PUBLIC_PROXY_PORT=8099 \
NORAV_SECURE_COOKIE=true \
./norav
```

When TLS is configured, NoRav automatically marks its session cookies `Secure`. `NORAV_SECURE_COOKIE=true` can also be used when TLS is terminated by a trusted reverse proxy. Configure the reverse proxy so the dashboard and proxy remain separate origins and share the same host.

Let's Encrypt supports publicly trusted IP-address certificates via Certbot 5.4+ and its `shortlived` profile. These certificates last 160 hours and must be renewed automatically. The webroot challenge path must be served by the existing port-80 web server; do not stop or replace another service to run the standalone challenge. See the [Let's Encrypt IP certificate instructions](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) before setting this up.

**Important:** the current VDS deployment is HTTP, not HTTPS. The proxy's connection to destination websites uses their real hostname with TLS where the destination uses HTTPS, but the connection between your browser and the raw VDS IP is not encrypted until you configure a trusted certificate or TLS reverse proxy. Do not use the HTTP deployment over an untrusted network for passwords or sensitive browsing.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NORAV_UI_ADDR` | `0.0.0.0:7845` | Dashboard listener |
| `NORAV_PROXY_ADDR` | `0.0.0.0:8099` | Proxy gateway listener (bind to loopback behind TLS termination) |
| `NORAV_PUBLIC_PROXY_PORT` | `8099` | Public HTTPS proxy port used to validate generated engine URLs |
| `NORAV_ENGINE_PROXY_ADDR` | `127.0.0.1:17860` | Internal Hammerhead proxy listener |
| `NORAV_ENGINE_CONTROL_ADDR` | `127.0.0.1:17862` | Internal engine control API |
| `NORAV_ENGINE_PROXY_PORT` | `17860` | TypeScript engine HTTP listener |
| `NORAV_ENGINE_CROSS_PORT` | `17861` | TypeScript engine secondary listener |
| `NORAV_ENGINE_CONTROL_PORT` | `17862` | TypeScript engine control listener |
| `NORAV_PUBLIC_ORIGIN` | Set in engine service | Public proxy origin used to generate browser URLs |
| `NORAV_WEB_ROOT` | `./dist` | Built frontend directory |
| `NORAV_ACCESS_KEY` | generated file | Unlock key |
| `NORAV_ACCESS_KEY_FILE` | `./data/access.key` | Key-file path |
| `NORAV_IO_URING` | `auto` | `auto`, `on`, or `off` |
| `NORAV_TLS_CERT_FILE` | unset | TLS certificate chain |
| `NORAV_TLS_KEY_FILE` | unset | TLS private key |
| `NORAV_SECURE_COOKIE` | automatic with TLS | Mark session cookies Secure |
| `NORAV_TRUSTED_PROXIES` | unset | Comma-separated trusted proxy IPs/CIDRs for forwarded client-IP headers |
| `NORAV_METRICS_TOKEN` | unset | Optional bearer token for Prometheus metrics |

## Proxy capabilities

- HTTP and HTTPS destinations, redirects, forms, common HTML links, images, `srcset`, fonts, CSS `url()` and `@import`, scripts, common fetch/XHR traffic, EventSource, WebSockets, and streaming media responses.
- Per-session destination cookies managed by the Hammerhead session. NoRav authentication and refresh cookies remain HttpOnly and are isolated from destination pages.
- Per-request IDs and W3C trace IDs, structured logs, client-IP attribution, per-IP counters, recent request events, and Prometheus metrics.
- Destination validation and DNS resolution checks reject private, loopback, link-local, multicast, reserved, and metadata-service addresses. Destination ports are limited to 80, 443, 8080, and 8443.
- Per-IP concurrency limiting and login-attempt rate limiting.

## Observability endpoints

- `GET /api/health`: dashboard health.
- `GET /healthz`: proxy health.
- `GET /api/analytics`: authenticated JSON request analytics, including per-IP activity and recent requests.
- `GET /api/metrics`: Prometheus text format. Access requires a NoRav session, `NORAV_METRICS_TOKEN`, or a loopback client.

Each request log includes a request ID, trace ID/span ID, client IP, method, path, upstream hostname, status, bytes, duration, and user agent. Forwarded client IP headers are only trusted when the immediate peer belongs to `NORAV_TRUSTED_PROXIES`.

## Performance

The Go dashboard and public gateway use `io_uring` through `github.com/brickingsoft/rio` on supported Linux kernels. The TypeScript/Hammerhead sidecar handles destination HTTP(S) requests through Node.js networking. The Go gateway uses pooled connections to the sidecar, while the engine keeps response rewriting and browser-session handling in one place. `NORAV_IO_URING=auto` falls back to the standard Go network stack if the kernel or environment rejects ring setup; `on` requires the ring path; `off` uses the standard stack. The engine service sets a bounded 128 KiB Node HTTP header limit to accommodate large upstream sites without removing parser limits.

The interface is split into route/feature files and uses the installed Arc registry components and blocks. Preferences include reduced motion, low-power mode, adaptive low-end-device performance, media handling, and data saver.

## Compatibility notes

A reverse proxy cannot perfectly impersonate a full browser for every origin. Sites that require service workers, strict origin-bound APIs, certificate pinning, unusual authentication flows, WebRTC, browser extensions, or hard-coded absolute origins may partially fail. The bridge disables service-worker registration and rewrites common request/resource paths; it does not rewrite every possible JavaScript-generated URL. The proxy also intentionally rejects private/internal destinations rather than acting as a way into the VDS's private network.
