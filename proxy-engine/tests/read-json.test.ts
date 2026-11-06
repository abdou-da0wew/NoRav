import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { RequestBodyError, readJsonBody } from "../src/http/read-json.js";

function createRequest(body: string): IncomingMessage {
  return Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
}

test("parses JSON request bodies", async () => {
  const result = await readJsonBody<{ target: string }>(
    createRequest('{"target":"https://example.com/"}'),
  );

  assert.deepEqual(result, { target: "https://example.com/" });
});

test("treats an empty request body as an empty object", async () => {
  assert.deepEqual(await readJsonBody(createRequest("")), {});
});

test("rejects malformed JSON", async () => {
  await assert.rejects(
    readJsonBody(createRequest("{invalid")),
    (error: unknown) => error instanceof RequestBodyError && error.statusCode === 400,
  );
});

test("drains and rejects oversized request bodies", async () => {
  await assert.rejects(
    readJsonBody(createRequest('{"payload":"too large"}'), 8),
    (error: unknown) => error instanceof RequestBodyError && error.statusCode === 413,
  );
});
