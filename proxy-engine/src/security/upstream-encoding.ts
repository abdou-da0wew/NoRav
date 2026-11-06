import type { ClientRequest, OutgoingHttpHeaders } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type RequestArguments = unknown[];

type RequestOptionsWithHeaders = {
  readonly headers?: OutgoingHttpHeaders;
  readonly method?: string;
  readonly path?: string;
  readonly pathname?: string;
  readonly isAjax?: boolean;
  readonly isWebSocket?: boolean;
};

type MutableRequestModule = {
  request: (...args: RequestArguments) => ClientRequest;
};

const REWRITTEN_FETCH_DESTINATIONS = new Set([
  "document",
  "iframe",
  "frame",
  "script",
  "style",
  "worker",
  "sharedworker",
  "serviceworker",
]);

const REWRITTEN_ACCEPT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/manifest+json",
];

const REWRITTEN_PATH_EXTENSIONS = [
  ".html",
  ".htm",
  ".xhtml",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".webmanifest",
  ".manifest",
];

function getHeader(
  headers: OutgoingHttpHeaders | undefined,
  expectedName: string,
): string | undefined {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== expectedName) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.join(",").toLowerCase();
    }

    if (value !== undefined) {
      return String(value).toLowerCase();
    }
  }

  return undefined;
}

function getPathname(input: unknown, options: RequestOptionsWithHeaders): string {
  const requestPath = options.pathname ?? options.path;

  if (requestPath) {
    return requestPath.split("?")[0] ?? "";
  }

  try {
    if (input instanceof URL) {
      return input.pathname;
    }

    if (typeof input === "string" && /^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      return new URL(input).pathname;
    }
  } catch {
    return "";
  }

  return "";
}

function requiresIdentityEncoding(
  input: unknown,
  options: RequestOptionsWithHeaders,
): boolean {
  if (options.isWebSocket || options.method?.toUpperCase() === "HEAD") {
    return false;
  }

  const fetchDestination = getHeader(options.headers, "sec-fetch-dest");

  if (fetchDestination && REWRITTEN_FETCH_DESTINATIONS.has(fetchDestination)) {
    return true;
  }

  const accept = getHeader(options.headers, "accept") ?? "";

  if (REWRITTEN_ACCEPT_TYPES.some((contentType) => accept.includes(contentType))) {
    return true;
  }

  if (options.isAjax) {
    return false;
  }

  const pathname = getPathname(input, options).toLowerCase();

  return REWRITTEN_PATH_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

function forceIdentityHeaders(
  headers: OutgoingHttpHeaders | undefined,
): OutgoingHttpHeaders {
  const normalized: OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== "accept-encoding") {
      normalized[name] = value;
    }
  }

  normalized["accept-encoding"] = "identity";
  return normalized;
}

function withIdentityEncoding(args: RequestArguments): RequestArguments {
  const [input, secondArgument, thirdArgument] = args;

  if (typeof input === "string" || input instanceof URL) {
    const options =
      typeof secondArgument === "object" && secondArgument !== null
        ? (secondArgument as RequestOptionsWithHeaders)
        : {};

    if (!requiresIdentityEncoding(input, options)) {
      return args;
    }

    const updatedOptions = {
      ...options,
      headers: forceIdentityHeaders(options.headers),
    };

    if (typeof secondArgument === "function") {
      return [input, updatedOptions, secondArgument];
    }

    return [input, updatedOptions, thirdArgument];
  }

  if (typeof input === "object" && input !== null) {
    const options = input as RequestOptionsWithHeaders;

    if (!requiresIdentityEncoding(input, options)) {
      return args;
    }

    return [
      {
        ...options,
        headers: forceIdentityHeaders(options.headers),
      },
      secondArgument,
      thirdArgument,
    ];
  }

  return args;
}

export interface UpstreamEncodingGuard {
  restore(): void;
}

export function installUpstreamEncodingGuard(): UpstreamEncodingGuard {
  const httpModule = require("node:http") as MutableRequestModule;
  const httpsModule = require("node:https") as MutableRequestModule;

  const originalHttpRequest = httpModule.request;
  const originalHttpsRequest = httpsModule.request;

  httpModule.request = function (...args: RequestArguments): ClientRequest {
    return Reflect.apply(
      originalHttpRequest,
      this,
      withIdentityEncoding(args),
    ) as ClientRequest;
  };

  httpsModule.request = function (...args: RequestArguments): ClientRequest {
    return Reflect.apply(
      originalHttpsRequest,
      this,
      withIdentityEncoding(args),
    ) as ClientRequest;
  };

  let restored = false;

  return {
    restore() {
      if (restored) {
        return;
      }

      restored = true;
      httpModule.request = originalHttpRequest;
      httpsModule.request = originalHttpsRequest;
    },
  };
}

export const upstreamEncodingInternals = {
  forceIdentityHeaders,
  requiresIdentityEncoding,
  withIdentityEncoding,
};
