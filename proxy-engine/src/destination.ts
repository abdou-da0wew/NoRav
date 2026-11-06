import { isIP } from "node:net";
import { isPublicAddress } from "./security/ip-address.js";

const ALLOWED_DESTINATION_PORTS = new Set(["80", "443", "8080", "8443"]);

export class DestinationValidationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 = 400,
  ) {
    super(message);
    this.name = "DestinationValidationError";
  }
}

export function parseDestination(input: string): URL {
  let target: URL;

  try {
    target = new URL(input);
  } catch {
    throw new DestinationValidationError("Invalid destination URL");
  }

  if (
    !["http:", "https:"].includes(target.protocol) ||
    !target.hostname ||
    target.username ||
    target.password
  ) {
    throw new DestinationValidationError("Unsupported destination URL");
  }

  const port = target.port || (target.protocol === "https:" ? "443" : "80");

  if (!ALLOWED_DESTINATION_PORTS.has(port)) {
    throw new DestinationValidationError("Destination port is not allowed");
  }

  const family = isIP(target.hostname.replace(/^\[|\]$/g, ""));

  if (family !== 0 && !isPublicAddress(target.hostname, family)) {
    throw new DestinationValidationError("Destination IP address is not public", 403);
  }

  return target;
}
