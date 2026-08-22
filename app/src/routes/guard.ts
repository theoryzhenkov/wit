import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db, schema } from "../lib/db";

// Session + vault-membership guards for the editor/management surface.
// spec: docs/platform/L1-platform#auth-editor
// spec: docs/model/L1-model#vault-access

export interface GuardEnv {
  Variables: {
    user: { id: string };
    membership: { vaultId: string; role: "owner" | "editor" };
  };
}

export const requireSession = createMiddleware<GuardEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("user", session.user);
  await next();
});

export async function getMembership(
  userId: string,
  vaultId: string,
): Promise<{ vaultId: string; role: "owner" | "editor" } | null> {
  const [row] = await db
    .select({ vaultId: schema.vaultMembers.vaultId, role: schema.vaultMembers.role })
    .from(schema.vaultMembers)
    .where(and(eq(schema.vaultMembers.vaultId, vaultId), eq(schema.vaultMembers.userId, userId)));
  return row ?? null;
}

/** Requires a `vaultId` path param; 404 (not 403) for non-members so
 *  membership doesn't leak vault existence. */
export const requireMembership = createMiddleware<GuardEnv>(async (c, next) => {
  const vaultId = c.req.param("vaultId");
  if (!vaultId || !/^[0-9a-f-]{36}$/.test(vaultId)) {
    return c.json({ error: "not found" }, 404);
  }
  const membership = await getMembership(c.get("user").id, vaultId);
  if (!membership) return c.json({ error: "not found" }, 404);
  c.set("membership", membership);
  await next();
});
