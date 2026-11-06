import { isIP } from "node:net";

type Ipv6Groups = [number, number, number, number, number, number, number, number];

type Ipv4Range = {
  readonly start: number;
  readonly end: number;
};

const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function stripIpv6Brackets(address: string): string {
  return address.startsWith("[") && address.endsWith("]")
    ? address.slice(1, -1)
    : address;
}

function parseIpv4Number(address: string): number | null {
  const parts = address.split(".");

  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part))) {
    return null;
  }

  const octets = parts.map(Number);

  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }

  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function createIpv4Range(network: string, prefix: number): Ipv4Range {
  const start = parseIpv4Number(network);

  if (start === null || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 CIDR entry: ${network}/${prefix}`);
  }

  return {
    start,
    end: start + 2 ** (32 - prefix) - 1,
  };
}

const BLOCKED_IPV4_RANGES = BLOCKED_IPV4_CIDRS.map(([network, prefix]) =>
  createIpv4Range(network, prefix),
);

function parseIpv6Groups(address: string): Ipv6Groups | null {
  if (address.includes("%") || !/^[0-9a-f:.]+$/i.test(address)) {
    return null;
  }

  let value = address.toLowerCase();

  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    const ipv4 = parseIpv4Number(value.slice(separator + 1));

    if (separator < 0 || ipv4 === null) {
      return null;
    }

    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    value = `${value.slice(0, separator)}:${high}:${low}`;
  }

  const compressionIndex = value.indexOf("::");

  if (compressionIndex !== -1 && value.indexOf("::", compressionIndex + 2) !== -1) {
    return null;
  }

  const sections =
    compressionIndex === -1
      ? [value]
      : [value.slice(0, compressionIndex), value.slice(compressionIndex + 2)];

  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  const missing = 8 - left.length - right.length;

  if (
    (sections.length === 1 && missing !== 0) ||
    (sections.length === 2 && missing < 1)
  ) {
    return null;
  }

  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  return groups.map((group) => Number.parseInt(group, 16)) as Ipv6Groups;
}

function isBlockedIpv4(address: string): boolean {
  const value = parseIpv4Number(address);

  if (value === null) {
    return true;
  }

  return BLOCKED_IPV4_RANGES.some(
    (range) => value >= range.start && value <= range.end,
  );
}

function isBlockedIpv6(groups: Ipv6Groups): boolean {
  const isIpv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

  if (isIpv4Mapped) {
    const mapped = groups[6] * 65_536 + groups[7];
    const ipv4 = [
      mapped >>> 24,
      (mapped >>> 16) & 255,
      (mapped >>> 8) & 255,
      mapped & 255,
    ].join(".");

    return isBlockedIpv4(ipv4);
  }

  // Unspecified, loopback, and deprecated IPv4-compatible addresses.
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return true;
  }

  // Only global-unicast space (2000::/3) is eligible.
  if ((groups[0] & 0xe000) !== 0x2000) {
    return true;
  }

  // IETF protocol assignments (2001::/23), 6to4, and documentation space.
  if (groups[0] === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8)) {
    return true;
  }

  if (groups[0] === 0x2002) {
    return true;
  }

  if (groups[0] === 0x3fff && (groups[1] & 0xf000) === 0) {
    return true;
  }

  return false;
}

export function isPublicAddress(
  address: string,
  family = isIP(stripIpv6Brackets(address)),
): boolean {
  const normalized = stripIpv6Brackets(address);

  if (family === 4) {
    return !isBlockedIpv4(normalized);
  }

  if (family === 6) {
    const groups = parseIpv6Groups(normalized);
    return groups !== null && !isBlockedIpv6(groups);
  }

  return false;
}
