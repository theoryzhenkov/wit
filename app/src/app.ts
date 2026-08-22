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

// The editor SPA (vite build output), served from the same process.
// spec: docs/platform/L1-platform#one-process
const WEB_ROOT = new URL("../dist/web/", import.meta.url).pathname;

app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
  const rel = c.req.path.replace(/^\/+/, "");
  if (rel.split("/").some((s) => s === "..")) return c.json({ error: "not found" }, 404);
  const file = Bun.file(WEB_ROOT + (rel || "index.html"));
  if (await file.exists()) return new Response(file);
  const index = Bun.file(WEB_ROOT + "index.html");
  if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html" } });
  return c.text("wit api is up; the editor is not built (bun run build)", 200);
});
