import { app } from "./app";
import { maybeUpgradeDocSocket, relayWebsocket } from "./lib/yjs/relay";

// One Bun process: REST + Yjs websocket relay (SSE and the editor SPA
// join in later phases). spec: docs/platform/L1-platform#one-process

export function startServer(port: number) {
  return Bun.serve({
    port,
    async fetch(req, server) {
      const upgrade = await maybeUpgradeDocSocket(req, server);
      if (upgrade !== null) return upgrade;
      return app.fetch(req);
    },
    websocket: relayWebsocket,
  });
}
