import assert from "node:assert/strict";
import test from "node:test";
import { DestinationValidationError, parseDestination } from "../src/destination.js";

test("accepts normal HTTP and HTTPS destinations", () => {
  assert.equal(
    parseDestination("http://example.com/path?q=1").href,
    "http://example.com/path?q=1",
  );
  assert.equal(parseDestination("https://example.com/").href, "https://example.com/");
  assert.equal(parseDestination("https://example.com:8443/").port, "8443");
});

test("rejects non-HTTP protocols, credentials, and unapproved ports", () => {
  for (const target of [
    "ftp://example.com/",
    "http://user:pass@example.com/",
    "http://example.com:22/",
    "https://example.com:3000/",
  ]) {
    assert.throws(() => parseDestination(target), DestinationValidationError);
  }
});

test("rejects non-public literal IP destinations", () => {
  for (const target of [
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[fc00::1]/",
  ]) {
    assert.throws(
      () => parseDestination(target),
      (error: unknown) =>
        error instanceof DestinationValidationError && error.statusCode === 403,
    );
  }
});
