import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EngineConfig } from "../src/config.js";
import { startProxyEngine } from "../src/proxy-server.js";

async function getAvailablePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Could not allocate a TCP port");
  }

  const port = address.port;
  await closeServer(server);
  return port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("starts, authenticates, opens, rejects, and revokes engine sessions", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "norav-engine-test-"));
  const keyFile = join(directory, "access.key");
  const key = randomBytes(48).toString("base64url");
  await writeFile(keyFile, key, { mode: 0o600 });

  const [enginePort, crossPort, controlPort] = await Promise.all([
    getAvailablePort(),
    getAvailablePort(),
    getAvailablePort(),
  ]);

  assert.equal(new Set([enginePort, crossPort, controlPort]).size, 3);

  const config: EngineConfig = {
    bindHost: "127.0.0.1",
    enginePort,
    crossPort,
    controlPort,
    keyFile,
    publicOrigin: new URL(`http://127.0.0.1:${enginePort}`),
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1_000,
  };

  const expectedToken = createHash("sha256")
    .update(`norav-cookie-signing:${key}`)
    .digest("hex");

  const engine = await startProxyEngine(config);
  context.after(async () => {
    await engine.shutdown();
    await rm(directory, { recursive: true, force: true });
  });

  const endpoint = `http://127.0.0.1:${controlPort}`;
  const authHeaders = {
    "content-type": "application/json",
    "x-norav-internal-token": expectedToken,
  };

  const unauthorized = await fetch(`${endpoint}/health`);
  assert.equal(unauthorized.status, 401);

  const health = await fetch(`${endpoint}/health`, {
    headers: authHeaders,
  });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    engine: "hammerhead",
    sessions: 0,
  });

  const sessionKey = randomBytes(32).toString("hex");
  const opened = await fetch(`${endpoint}/session`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sessionKey,
      target: "https://example.com/",
    }),
  });

  assert.equal(opened.status, 200);
  const session = (await opened.json()) as {
    readonly url: string;
    readonly engineId: string;
  };
  assert.ok(session.engineId.length > 0);

  const proxyUrl = new URL(session.url);
  assert.equal(proxyUrl.origin, config.publicOrigin.origin);
  assert.ok(proxyUrl.pathname.includes("https://example.com/"));

  const proxiedPage = await fetch(session.url, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(proxiedPage.status, 200);
  assert.match(proxiedPage.headers.get("content-type") ?? "", /text\/html/i);
  const proxiedHtml = await proxiedPage.text();
  assert.match(proxiedHtml, /Example Domain/);
  assert.equal(proxiedPage.headers.get("content-encoding"), null);

  const privateDestination = await fetch(`${endpoint}/session`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sessionKey: randomBytes(32).toString("hex"),
      target: "http://169.254.169.254/latest/meta-data/",
    }),
  });
  assert.equal(privateDestination.status, 403);

  const malformed = await fetch(`${endpoint}/session`, {
    method: "POST",
    headers: authHeaders,
    body: "{invalid",
  });
  assert.equal(malformed.status, 400);

  const revoked = await fetch(`${endpoint}/revoke`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ sessionKey }),
  });
  assert.deepEqual(await revoked.json(), { ok: true, removed: true });

  const afterRevoke = await fetch(`${endpoint}/health`, {
    headers: authHeaders,
  });
  assert.deepEqual(await afterRevoke.json(), {
    ok: true,
    engine: "hammerhead",
    sessions: 0,
  });

  const concurrentKeys = Array.from({ length: 32 }, () =>
    randomBytes(32).toString("hex"),
  );
  const concurrentOpens = await Promise.all(
    concurrentKeys.map((concurrentKey) =>
      fetch(`${endpoint}/session`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          sessionKey: concurrentKey,
          target: "https://example.com/",
        }),
      }),
    ),
  );

  assert.ok(concurrentOpens.every((response) => response.status === 200));
  const concurrentSessions = await Promise.all(
    concurrentOpens.map(
      (response) =>
        response.json() as Promise<{ readonly url: string; readonly engineId: string }>,
    ),
  );
  assert.equal(
    new Set(concurrentSessions.map((entry) => entry.engineId)).size,
    concurrentKeys.length,
  );

  const concurrentHealth = await fetch(`${endpoint}/health`, {
    headers: authHeaders,
  });
  assert.deepEqual(await concurrentHealth.json(), {
    ok: true,
    engine: "hammerhead",
    sessions: concurrentKeys.length,
  });

  const concurrentRevokes = await Promise.all(
    concurrentKeys.map((concurrentKey) =>
      fetch(`${endpoint}/revoke`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ sessionKey: concurrentKey }),
      }),
    ),
  );
  const revokeResults = await Promise.all(
    concurrentRevokes.map((response) => response.json()),
  );
  assert.ok(
    revokeResults.every(
      (result) =>
        typeof result === "object" &&
        result !== null &&
        "removed" in result &&
        result.removed === true,
    ),
  );

  const afterConcurrentRevoke = await fetch(`${endpoint}/health`, {
    headers: authHeaders,
  });
  assert.deepEqual(await afterConcurrentRevoke.json(), {
    ok: true,
    engine: "hammerhead",
    sessions: 0,
  });

  const wrongToken = await fetch(`${endpoint}/health`, {
    headers: {
      "x-norav-internal-token": "wrong-token",
    },
  });
  assert.equal(wrongToken.status, 401);

  const keyContents = await readFile(keyFile, "utf8");
  assert.equal(keyContents, key);
});
