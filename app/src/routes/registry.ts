import { Hono } from "hono";
import { reconcileRegistry, validateManifests } from "../lib/store/registry";
import { requireWrite, withPrincipal, type PrincipalEnv } from "./principal";

// The registry push endpoint — `wit components sync`'s write target.
// Write key (or member session); the UI never writes here, it reads the
// components noun. spec: docs/model/L1-model#registry-manifests

export const registry = new Hono<PrincipalEnv>();

registry.use("*", withPrincipal, requireWrite);

registry.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const manifests = validateManifests(body);
  if (!manifests) return c.json({ error: "invalid manifest list" }, 400);
  // spec: docs/platform/L1-platform#sync-reconcile
  const result = await reconcileRegistry(c.get("principal").vaultId, manifests);
  return c.json(result);
});
