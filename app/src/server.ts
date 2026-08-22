import { app } from "./app";
import { maybeUpgradeDocSocket, relayWebsocket } from "./lib/yjs/relay";

// One Bun process: REST + Yjs websocket relay (SSE and the editor SPA
// join in later phases). spec: docs/platform/L1-platform#one-process

export function startServer(port: number) {
  return Bun.serve({
    port,
    // Request bodies are caller-controlled input: cap above the largest
    // legitimate payload (10 MB asset uploads) and let the per-route
    // checks handle the rest. spec: docs/platform/L1-platform#input-caps
    maxRequestBodySize: 16_000_000,
    async fetch(req, server) {
      const upgrade = await maybeUpgradeDocSocket(req, server);
      if (upgrade !== null) return upgrade;
      return app.fetch(req);
    },
    websocket: relayWebsocket,
  });
}
