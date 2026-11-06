import assert from "node:assert/strict";
import test from "node:test";
import { upstreamEncodingInternals } from "../src/security/upstream-encoding.js";

test("replaces existing Accept-Encoding headers case-insensitively", () => {
  const headers = upstreamEncodingInternals.forceIdentityHeaders({
    "Accept-Encoding": "gzip, br",
    accept: "text/html",
    "X-Test": "value",
  });

  assert.deepEqual(headers, {
    accept: "text/html",
    "X-Test": "value",
    "accept-encoding": "identity",
  });
});

test("requests identity encoding for rewritten document requests", () => {
  assert.equal(
    upstreamEncodingInternals.requiresIdentityEncoding("https://example.com/", {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-dest": "document",
      },
    }),
    true,
  );
});

test("requests identity encoding for rewritten scripts and stylesheets", () => {
  for (const destination of ["script", "style"]) {
    assert.equal(
      upstreamEncodingInternals.requiresIdentityEncoding(
        "https://cdn.example.com/asset",
        {
          headers: {
            accept: "*/*",
            "sec-fetch-dest": destination,
          },
        },
      ),
      true,
      destination,
    );
  }

  assert.equal(
    upstreamEncodingInternals.requiresIdentityEncoding(
      "https://cdn.example.com/app.js",
      { headers: { accept: "*/*" } },
    ),
    true,
  );
});

test("preserves compression for images and ordinary fetch requests", () => {
  assert.equal(
    upstreamEncodingInternals.requiresIdentityEncoding(
      "https://cdn.example.com/image.webp",
      {
        headers: {
          accept: "image/avif,image/webp,*/*",
          "sec-fetch-dest": "image",
        },
      },
    ),
    false,
  );

  assert.equal(
    upstreamEncodingInternals.requiresIdentityEncoding("https://api.example.com/data", {
      isAjax: true,
      headers: {
        accept: "*/*",
        "sec-fetch-dest": "empty",
      },
    }),
    false,
  );
});

test("preserves request URL overloads and callback positions", () => {
  const callback = (): void => {};
  const options = {
    headers: {
      "Accept-Encoding": "br",
      accept: "text/html",
    },
    method: "GET",
  };

  const target = new URL("https://example.com/");
  const result = upstreamEncodingInternals.withIdentityEncoding([
    target,
    options,
    callback,
  ]);

  assert.equal(result[0], target);
  assert.deepEqual(result[1], {
    method: "GET",
    headers: {
      accept: "text/html",
      "accept-encoding": "identity",
    },
  });
  assert.equal(result[2], callback);
});

test("preserves the callback overload when a rewritten file URL is supplied", () => {
  const callback = (): void => {};
  const target = "https://example.com/index.html";
  const result = upstreamEncodingInternals.withIdentityEncoding([target, callback]);

  assert.equal(result[0], target);
  assert.deepEqual(result[1], {
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(result[2], callback);
});

test("normalizes plain request option objects for rewritten assets", () => {
  const result = upstreamEncodingInternals.withIdentityEncoding([
    {
      protocol: "https:",
      hostname: "example.com",
      path: "/bundle.js",
      headers: { "ACCEPT-ENCODING": "gzip" },
    },
  ]);

  assert.deepEqual(result[0], {
    protocol: "https:",
    hostname: "example.com",
    path: "/bundle.js",
    headers: { "accept-encoding": "identity" },
  });
});
