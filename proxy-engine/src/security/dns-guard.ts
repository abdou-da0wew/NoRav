import * as dns from "node:dns";
import * as net from "node:net";
import { isPublicAddress } from "./ip-address.js";
import { installUpstreamEncodingGuard } from "./upstream-encoding.js";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

type LookupOptionsInput = number | dns.LookupOptions | LookupCallback;

function assertPublicHost(host: string): void {
  const normalized = host.replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);

  if (family !== 0 && !isPublicAddress(normalized, family)) {
    throw createBlockedAddressError();
  }

  if (normalized.includes(":") && family === 0) {
    throw createBlockedAddressError();
  }
}

function createBlockedAddressError(): NodeJS.ErrnoException {
  const error = new Error(
    "Destination resolves to a non-public IP address",
  ) as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

export function createSafeLookup(originalLookup: typeof dns.lookup): typeof dns.lookup {
  const safeLookup = (
    hostname: string,
    optionsOrCallback: LookupOptionsInput,
    callbackArgument?: LookupCallback,
  ): void => {
    const callback =
      typeof optionsOrCallback === "function" ? optionsOrCallback : callbackArgument;

    if (!callback) {
      throw new TypeError("dns.lookup callback is required");
    }

    const options =
      typeof optionsOrCallback === "number"
        ? { family: optionsOrCallback }
        : typeof optionsOrCallback === "function"
          ? {}
          : optionsOrCallback;

    const wantsAll = options.all === true;

    originalLookup(hostname, { ...options, all: true }, (error, records) => {
      if (error) {
        callback(error, wantsAll ? [] : "");
        return;
      }

      const publicRecords = records.filter((record) =>
        isPublicAddress(record.address, record.family),
      );

      if (publicRecords.length === 0) {
        callback(createBlockedAddressError(), wantsAll ? [] : "");
        return;
      }

      if (wantsAll) {
        callback(null, publicRecords);
        return;
      }

      const first = publicRecords[0];

      if (!first) {
        callback(createBlockedAddressError(), "");
        return;
      }

      callback(null, first.address, first.family);
    });
  };

  return safeLookup as typeof dns.lookup;
}

export interface NetworkGuard {
  readonly lookup: typeof dns.lookup;
  restore(): void;
}

export function installNetworkGuard(): NetworkGuard {
  const originalSocketConnect = net.Socket.prototype.connect;
  const guardedLookup = createSafeLookup(dns.lookup.bind(dns));
  const encodingGuard = installUpstreamEncodingGuard();

  const guardedConnect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = args[0];

    if (typeof first === "object" && first !== null) {
      const options = first as {
        host?: string;
        hostname?: string;
        lookup?: typeof dns.lookup;
      };
      const host = options.host ?? options.hostname;

      if (typeof host === "string") {
        assertPublicHost(host);
        args[0] = { ...options, lookup: guardedLookup };
      }
    } else if (typeof first === "number") {
      const hostArgument = args[1];
      const listenerArgument =
        typeof hostArgument === "function" ? hostArgument : args[2];
      const connectOptions: {
        port: number;
        host?: string;
        hostname?: string;
        path?: string;
        lookup?: typeof dns.lookup;
        [key: string]: unknown;
      } =
        typeof hostArgument === "object" && hostArgument !== null
          ? { ...(hostArgument as Record<string, unknown>), port: first }
          : { port: first };

      if (typeof hostArgument === "string") {
        connectOptions.host = hostArgument;
      }

      const host = connectOptions.host ?? connectOptions.hostname;

      if (typeof host === "string") {
        assertPublicHost(host);
      }

      if (!connectOptions.path) {
        connectOptions.lookup = guardedLookup;
      }

      args = [
        connectOptions,
        ...(typeof listenerArgument === "function" ? [listenerArgument] : []),
      ];
    }

    return Reflect.apply(originalSocketConnect, this, args) as net.Socket;
  };

  net.Socket.prototype.connect = guardedConnect as typeof net.Socket.prototype.connect;

  let restored = false;

  return {
    lookup: guardedLookup,
    restore() {
      if (restored) {
        return;
      }

      restored = true;
      net.Socket.prototype.connect = originalSocketConnect;
      encodingGuard.restore();
    },
  };
}
