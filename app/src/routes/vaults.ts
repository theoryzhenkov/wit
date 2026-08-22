import { Hono } from "hono";
import { createVault, listVaults } from "../lib/store/vaults";
import { requireSession, type GuardEnv } from "./guard";

// Vault management is an editor/UI surface: session-only, no API keys.
// spec: docs/platform/L1-platform#auth-editor

const MAX_NAME_LENGTH = 200;

export const vaults = new Hono<GuardEnv>();

vaults.use("*", requireSession);

vaults.get("/", async (c) => {
  return c.json(await listVaults(c.get("user").id));
});

vaults.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return c.json({ error: `name must be 1–${MAX_NAME_LENGTH} characters` }, 400);
  }
  const vault = await createVault(c.get("user").id, name);
  return c.json(vault, 201);
});
