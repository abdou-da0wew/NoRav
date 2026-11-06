import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface EngineConfig {
  readonly bindHost: "127.0.0.1";
  readonly enginePort: number;
  readonly crossPort: number;
  readonly controlPort: number;
  readonly keyFile: string;
  readonly publicOrigin: URL;
  readonly sessionLifetimeMs: number;
}

const DEFAULT_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

function parsePort(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return value;
}

function parsePublicOrigin(raw: string | undefined): URL {
  const value = raw ?? "http://127.0.0.1:8099";
  let origin: URL;

  try {
    origin = new URL(value);
  } catch {
    throw new Error("NORAV_PUBLIC_ORIGIN must be a valid absolute URL");
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    !origin.hostname ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "NORAV_PUBLIC_ORIGIN must contain only an HTTP(S) origin, without credentials, path, query, or fragment",
    );
  }

  return origin;
}

export function loadConfig(): EngineConfig {
  const enginePort = parsePort("NORAV_ENGINE_PROXY_PORT", 17_860);
  const crossPort = parsePort("NORAV_ENGINE_CROSS_PORT", 17_861);
  const controlPort = parsePort("NORAV_ENGINE_CONTROL_PORT", 17_862);

  if (new Set([enginePort, crossPort, controlPort]).size !== 3) {
    throw new Error("Proxy, cross-domain, and control ports must be different");
  }

  return {
    bindHost: "127.0.0.1",
    enginePort,
    crossPort,
    controlPort,
    keyFile: resolve(
      process.env.NORAV_ACCESS_KEY_FILE ??
        resolve(import.meta.dirname, "../../../data/access.key"),
    ),
    publicOrigin: parsePublicOrigin(process.env.NORAV_PUBLIC_ORIGIN),
    sessionLifetimeMs: DEFAULT_SESSION_LIFETIME_MS,
  };
}

export function createInternalToken(keyFile: string): string {
  const accessKey = readFileSync(keyFile, "utf8").trim();

  if (accessKey.length < 20) {
    throw new Error("NoRav access key must contain at least 20 characters");
  }

  return createHash("sha256").update(`norav-cookie-signing:${accessKey}`).digest("hex");
}
