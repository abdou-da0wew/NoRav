import { loadConfig } from "./config.js";
import { logEvent } from "./logger.js";
import { startProxyEngine } from "./proxy-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = await startProxyEngine(config);
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logEvent("engine_shutdown", { signal });

    void engine.shutdown().catch((error: unknown) => {
      logEvent("shutdown_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  logEvent("engine_start_error", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
