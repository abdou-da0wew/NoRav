import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress } from "../src/security/ip-address.js";

test("allows globally routable IPv4 addresses", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("blocks special-purpose and non-public IPv4 ranges", () => {
  const blocked = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.31.196.1",
    "192.52.193.1",
    "192.88.99.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ];

  for (const address of blocked) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("allows global-unicast IPv6 addresses", () => {
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("blocks local, mapped-private, transition, and reserved IPv6 addresses", () => {
  const blocked = [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::8.8.8.8",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2001:10::1",
    "2002::1",
    "3fff::1",
  ];

  for (const address of blocked) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("rejects malformed addresses and scoped IPv6 addresses", () => {
  assert.equal(isPublicAddress("999.1.1.1", 4), false);
  assert.equal(isPublicAddress("2001:4860:zzzz::1", 6), false);
  assert.equal(isPublicAddress("fe80::1%eth0", 6), false);
  assert.equal(isPublicAddress("not-an-ip"), false);
});
