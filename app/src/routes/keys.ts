import { Hono } from "hono";
import { createApiKey, deleteApiKey, listApiKeys } from "../lib/store/api-keys";
import { requireMembership, requireSession, type GuardEnv } from "./guard";

// API key management: session-only — keys carry no admin authority and
// cannot mint other keys. spec: docs/platform/L1-platform#api-key-scope

export const keys = new Hono<GuardEnv>();

keys.use("*", requireSession, requireMembership);

keys.get("/", async (c) => {
  return c.json(await listApiKeys(c.get("membership").vaultId));
});

keys.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  const scope = body?.scope;
  if (scope !== "read" && scope !== "write") {
    return c.json({ error: "scope must be read or write" }, 400);
  }
  const created = await createApiKey(c.get("membership").vaultId, name, scope);
  // The token appears in this response and nowhere else, ever.
  return c.json(created, 201);
});

keys.delete("/:keyId", async (c) => {
  const gone = await deleteApiKey(c.get("membership").vaultId, c.req.param("keyId"));
  if (!gone) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
