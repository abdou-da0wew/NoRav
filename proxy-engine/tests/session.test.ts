import assert from "node:assert/strict";
import test from "node:test";
import { NoRavSession } from "../src/session.js";
import { SessionRegistry } from "../src/session-registry.js";

test("provides a navigation payload and a quiet iframe payload", async () => {
  const session = new NoRavSession();

  assert.match(await session.getPayloadScript(), /norav:navigation/);
  assert.equal(await session.getIframePayloadScript(), "");
});

test("closes a failed top-level navigation with a safe 502 response", () => {
  const session = new NoRavSession();
  let statusCode = 0;
  let responseBody = "";

  session.handlePageError(
    {
      dest: { url: "https://example.com/private?token=must-not-be-logged" },
      closeWithError(status: number, body?: string) {
        statusCode = status;
        responseBody = body ?? "";
      },
    },
    Object.assign(new Error("upstream failed"), { code: "ECONNRESET" }),
  );

  assert.equal(statusCode, 502);
  assert.match(responseBody, /upstream website could not be loaded/i);
  assert.equal(responseBody.includes("token="), false);
});

test("creates, reuses, revokes, and closes sessions", () => {
  const closed: string[] = [];
  const registry = new SessionRegistry({
    closeSession(session) {
      closed.push(session.id);
    },
  });

  const first = registry.createOrGet("a".repeat(48));
  const reused = registry.createOrGet("a".repeat(48));

  assert.equal(registry.size, 1);
  assert.equal(first.session, reused.session);
  assert.equal(registry.remove("a".repeat(48)), true);
  assert.equal(registry.remove("a".repeat(48)), false);
  assert.deepEqual(closed, [first.engineId]);
  assert.equal(registry.size, 0);
});

test("removes expired sessions and retains active sessions", () => {
  const registry = new SessionRegistry({ closeSession() {} });
  const expired = registry.createOrGet("b".repeat(48));
  const active = registry.createOrGet("c".repeat(48));

  expired.lastUsed = 1_000;
  active.lastUsed = 9_500;

  assert.equal(registry.removeExpired(5_000, 10_000), 1);
  assert.equal(registry.size, 1);
  assert.equal(registry.remove("c".repeat(48)), true);
});
