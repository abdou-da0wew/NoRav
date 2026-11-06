import assert from "node:assert/strict";
import * as dns from "node:dns";
import * as net from "node:net";
import test from "node:test";
import { createSafeLookup, installNetworkGuard } from "../src/security/dns-guard.js";

function createLookupStub(records: dns.LookupAddress[]): typeof dns.lookup {
  return ((hostname, options, callback) => {
    assert.equal(hostname, "fixture.invalid");
    assert.equal(typeof options, "object");
    (
      callback as unknown as (
        error: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number,
      ) => void
    )(null, records);
  }) as typeof dns.lookup;
}

test("filters private DNS answers and retains public answers", async () => {
  const lookup = createSafeLookup(
    createLookupStub([
      { address: "127.0.0.1", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]),
  );

  const result = await new Promise<string>((resolve, reject) => {
    lookup("fixture.invalid", (error, address) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(String(address));
    });
  });

  assert.equal(result, "93.184.216.34");
});

test("returns every safe record when all is requested", async () => {
  const lookup = createSafeLookup(
    createLookupStub([
      { address: "10.0.0.5", family: 4 },
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]),
  );

  const records = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    lookup("fixture.invalid", { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(addresses as dns.LookupAddress[]);
    });
  });

  assert.deepEqual(
    records.map((record) => record.address),
    ["1.1.1.1", "2606:4700:4700::1111"],
  );
});

test("fails closed when DNS only returns non-public addresses", async () => {
  const lookup = createSafeLookup(
    createLookupStub([{ address: "169.254.169.254", family: 4 }]),
  );

  const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
    lookup("fixture.invalid", (result) => {
      assert.ok(result);
      resolve(result);
    });
  });

  assert.equal(error.code, "EACCES");
});

test("blocks direct connections to private IP literals", () => {
  const guard = installNetworkGuard();
  const socket = new net.Socket();

  try {
    assert.throws(() => socket.connect({ host: "127.0.0.1", port: 80 }), {
      code: "EACCES",
    });
  } finally {
    socket.destroy();
    guard.restore();
  }
});

test("blocks private destinations in the positional options overload", () => {
  const guard = installNetworkGuard();
  const socket = new net.Socket();

  try {
    assert.throws(
      () =>
        (
          socket.connect as unknown as (
            port: number,
            options: { host: string; localAddress: string },
          ) => net.Socket
        ).call(socket, 80, {
          host: "127.0.0.1",
          localAddress: "127.0.0.1",
        }),
      { code: "EACCES" },
    );
  } finally {
    socket.destroy();
    guard.restore();
  }
});

test("does not allow a custom socket lookup to bypass DNS filtering", async () => {
  const guard = installNetworkGuard();
  const socket = new net.Socket();

  try {
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      socket.once("error", resolve);
      socket.connect({
        host: "localhost",
        port: 9,
        lookup: (_hostname, _options, callback) => {
          callback(null, "8.8.8.8", 4);
        },
      });
    });

    assert.equal(error.code, "EACCES");
  } finally {
    socket.destroy();
    guard.restore();
  }
});
