import { Hono } from "hono";
import { auth } from "./lib/auth";
import { assets } from "./routes/assets";
import { collections } from "./routes/collections";
import { content } from "./routes/content";
import { docs } from "./routes/docs";
import { keys } from "./routes/keys";
import { registry } from "./routes/registry";
import { vaults } from "./routes/vaults";

// The one Hono app behind the one Bun process (REST now; the Yjs relay,
// SSE, and editor serving join it in later phases).
// spec: docs/platform/L1-platform#one-process

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/vaults", vaults);
app.route("/api/vaults/:vaultId/docs", docs);
app.route("/api/vaults/:vaultId/keys", keys);
app.route("/api/vaults/:vaultId/collections", collections);
app.route("/api/vaults/:vaultId/registry", registry);
app.route("/api/vaults/:vaultId/assets", assets);

// The content API: seven nouns, one grammar, GETs with strong ETags.
// spec: docs/platform/L1-platform#grammar-nouns
app.route("/api/content", content);
