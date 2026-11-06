import type { IncomingMessage } from "node:http";

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes = 16_384,
): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  return await new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    request.on("data", (chunk: Buffer | string) => {
      if (oversized) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;

      if (size > maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }

      chunks.push(buffer);
    });

    request.once("error", () => {
      reject(new RequestBodyError("Could not read request body"));
    });

    request.once("end", () => {
      if (oversized) {
        reject(new RequestBodyError("Request body is too large", 413));
        return;
      }

      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(body || "{}") as T);
      } catch {
        reject(new RequestBodyError("Request body must contain valid JSON"));
      }
    });
  });
}
