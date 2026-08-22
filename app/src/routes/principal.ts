import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth";
import type { Principal } from "../lib/content/grammar";
import { resolveApiKey } from "../lib/store/api-keys";
import { getMembership } from "./guard";

// Principal resolution for API-key-bearing surfaces: session member
// (full), write key (full content, no admin), read key (public +
// unlisted-direct). spec: docs/platform/L1-platform#api-key-scope

export interface PrincipalEnv {
  Variables: { principal: Principal };
}

export const withPrincipal = createMiddleware<PrincipalEnv>(async (c, next) => {
  const vaultId = c.req.param("vaultId");
  if (!vaultId || !/^[0-9a-f-]{36}$/.test(vaultId)) return c.json({ error: "not found" }, 404);

  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const key = await resolveApiKey(bearer.trim());
    if (!key || key.vaultId !== vaultId) return c.json({ error: "unauthorized" }, 401);
    c.set("principal", { kind: key.scope === "write" ? "write" : "read", vaultId });
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    const membership = await getMembership(session.user.id, vaultId);
    if (membership) {
      c.set("principal", { kind: "member", vaultId });
      return next();
    }
  }
  return c.json({ error: "unauthorized" }, 401);
});

/** Write access: member or write key; read keys are read-only.
 *  spec: docs/platform/L1-platform#api-key-scope */
export const requireWrite = createMiddleware<PrincipalEnv>(async (c, next) => {
  if (c.get("principal").kind === "read") return c.json({ error: "forbidden" }, 403);
  await next();
});
