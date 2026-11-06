import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import * as httpTypes from "node:http";
import { createRequire } from "node:module";
import hammerhead from "testcafe-hammerhead";
import type { EngineConfig } from "./config.js";
import { createInternalToken } from "./config.js";
import { DestinationValidationError, parseDestination } from "./destination.js";
import { RequestBodyError, readJsonBody } from "./http/read-json.js";
import { logEvent } from "./logger.js";
import { installNetworkGuard, type NetworkGuard } from "./security/dns-guard.js";
import { SessionRegistry } from "./session-registry.js";

const require = createRequire(import.meta.url);
const http = require("node:http") as {
  createServer: typeof httpTypes.createServer;
};

interface SessionRequestBody {
  readonly sessionKey?: unknown;
  readonly target?: unknown;
}

interface RevokeRequestBody {
  readonly sessionKey?: unknown;
}

interface EngineSessionResponse {
  readonly url: string;
  readonly engineId: string;
}

interface RuntimeProxy extends hammerhead.Proxy {
  readonly server1: Server;
  readonly server2: Server;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function safeEqual(
  candidate: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof candidate !== "string") {
    return false;
  }

  const provided = Buffer.from(candidate);
  const reference = Buffer.from(expected);

  return provided.length === reference.length && timingSafeEqual(provided, reference);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode).end(JSON.stringify(body));
}

async function waitForListening(server: Server): Promise<void> {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
  });
}

function listenControlServer(
  server: Server,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function restrictHammerheadBindAddress(host: string): () => void {
  const originalCreateServer = http.createServer;

  const wrappedCreateServer = ((
    ...args: Parameters<typeof http.createServer>
  ): Server => {
    const server = Reflect.apply(originalCreateServer, http, args) as Server;
    const originalListen = server.listen.bind(server);

    server.listen = ((...listenArgs: unknown[]) => {
      if (listenArgs.length === 1 && typeof listenArgs[0] === "number") {
        return originalListen(listenArgs[0], host);
      }

      return Reflect.apply(originalListen, server, listenArgs) as Server;
    }) as typeof server.listen;

    return server;
  }) as typeof http.createServer;

  http.createServer = wrappedCreateServer;

  return () => {
    http.createServer = originalCreateServer;
  };
}

function applyPublicOrigin(proxy: hammerhead.Proxy, origin: URL): void {
  const publicPort = Number(origin.port || (origin.protocol === "https:" ? 443 : 80));

  for (const serverInfo of [proxy.server1Info, proxy.server2Info]) {
    if (!serverInfo) {
      continue;
    }

    Object.assign(serverInfo, {
      hostname: origin.hostname,
      port: publicPort,
      protocol: origin.protocol,
      domain: origin.origin,
      crossDomainPort: publicPort,
    });
  }
}

function createHammerheadProxy(config: EngineConfig): RuntimeProxy {
  const proxy = new hammerhead.Proxy({}) as RuntimeProxy;
  const restoreCreateServer = restrictHammerheadBindAddress(config.bindHost);

  try {
    proxy.start({
      hostname: config.publicOrigin.hostname,
      port1: config.enginePort,
      port2: config.crossPort,
      developmentMode: false,
      cache: false,
      disableHttp2: true,
      disableCrossDomain: true,
    } as Parameters<hammerhead.Proxy["start"]>[0]);
    applyPublicOrigin(proxy, config.publicOrigin);
    return proxy;
  } catch (error) {
    proxy.close();
    throw error;
  } finally {
    restoreCreateServer();
  }
}

function createControlHandler(
  registry: SessionRegistry,
  internalToken: string,
  proxy: hammerhead.Proxy,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const openSession = proxy.openSession.bind(proxy) as unknown as (
    url: string,
    session: hammerhead.Session,
    externalProxySettings?: unknown,
  ) => string;

  return async (request, response): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }

    if (!safeEqual(request.headers["x-norav-internal-token"], internalToken)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    const requestPath = new URL(request.url ?? "/", "http://norav-control.invalid")
      .pathname;

    if (request.method === "GET" && requestPath === "/health") {
      sendJson(response, 200, {
        ok: true,
        engine: "hammerhead",
        sessions: registry.size,
      });
      return;
    }

    try {
      if (request.method === "POST" && requestPath === "/session") {
        const input = await readJsonBody<SessionRequestBody>(request);
        const ownerSession =
          typeof input.sessionKey === "string" ? input.sessionKey : "";

        if (ownerSession.length < 32 || ownerSession.length > 128) {
          sendJson(response, 400, { error: "invalid session key" });
          return;
        }

        const targetInput = typeof input.target === "string" ? input.target : "";
        const target = parseDestination(targetInput);
        const entry = registry.createOrGet(ownerSession);
        const url = openSession(target.href, entry.session);

        sendJson(response, 200, {
          url,
          engineId: entry.engineId,
        } satisfies EngineSessionResponse);
        logEvent("session_opened", {
          engineId: entry.engineId,
          host: target.hostname,
        });
        return;
      }

      if (request.method === "POST" && requestPath === "/revoke") {
        const input = await readJsonBody<RevokeRequestBody>(request);
        const ownerSession =
          typeof input.sessionKey === "string" ? input.sessionKey : "";
        const removed = registry.remove(ownerSession);

        sendJson(response, 200, { ok: true, removed });
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof DestinationValidationError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      if (error instanceof RequestBodyError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      logEvent("control_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      sendJson(response, 500, { error: "internal control error" });
    }
  };
}

function createInternalTokenFromConfig(config: EngineConfig): string {
  return createInternalToken(config.keyFile);
}

export interface ProxyEngine {
  shutdown(): Promise<void>;
}

export async function startProxyEngine(config: EngineConfig): Promise<ProxyEngine> {
  const networkGuard: NetworkGuard = installNetworkGuard();
  let proxy: RuntimeProxy | undefined;
  let controlServer: Server | undefined;
  let registry: SessionRegistry | undefined;
  let cleanupTimer: NodeJS.Timeout | undefined;

  try {
    const internalToken = createInternalTokenFromConfig(config);
    proxy = createHammerheadProxy(config);
    registry = new SessionRegistry(proxy);

    const handler = createControlHandler(registry, internalToken, proxy);
    controlServer = http.createServer((request, response) => {
      void handler(request, response);
    });

    cleanupTimer = setInterval(
      () => {
        registry?.removeExpired(config.sessionLifetimeMs);
      },
      15 * 60 * 1_000,
    );
    cleanupTimer.unref();

    await Promise.all([
      waitForListening(proxy.server1),
      waitForListening(proxy.server2),
      listenControlServer(controlServer, config.controlPort, config.bindHost),
    ]);

    for (const server of [proxy.server1, proxy.server2]) {
      server.prependListener("request", (request) => {
        registry?.touchByProxyUrl(request.url);
      });
    }

    logEvent("engine_ready", {
      engine: "hammerhead",
      publicOrigin: config.publicOrigin.origin,
      internalProxyPorts: [config.enginePort, config.crossPort],
      controlPort: config.controlPort,
    });

    return {
      async shutdown(): Promise<void> {
        if (cleanupTimer) {
          clearInterval(cleanupTimer);
        }

        try {
          registry?.closeAll();
          proxy?.close();

          if (controlServer?.listening) {
            await new Promise<void>((resolve) => {
              controlServer?.close(() => resolve());
            });
          }
        } finally {
          networkGuard.restore();
        }
      },
    };
  } catch (error) {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }

    try {
      registry?.closeAll();
      proxy?.close();

      if (controlServer?.listening) {
        await new Promise<void>((resolve) => {
          controlServer?.close(() => resolve());
        });
      }
    } finally {
      networkGuard.restore();
    }

    throw error;
  }
}
