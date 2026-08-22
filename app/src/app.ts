import { Hono } from "hono";
import { auth } from "./lib/auth";
import { docs } from "./routes/docs";
import { vaults } from "./routes/vaults";

// The one Hono app behind the one Bun process (REST now; the Yjs relay,
// SSE, and editor serving join it in later phases).
// spec: docs/platform/L1-platform#one-process

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/vaults", vaults);
app.route("/api/vaults/:vaultId/docs", docs);
