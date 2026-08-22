import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";

// Vault-scoped API keys. The token is shown exactly once at creation;
// only its SHA-256 lands in the database.
// spec: docs/platform/L1-platform#api-key-scope

export type KeyScope = "read" | "write";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiKey(
  vaultId: string,
  name: string,
  scope: KeyScope,
): Promise<{ id: string; token: string }> {
  const token = `wit_${scope}_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ vaultId, name, scope, tokenHash: hashToken(token) })
    .returning({ id: schema.apiKeys.id });
  return { id: row!.id, token };
}

export interface ResolvedKey {
  id: string;
  vaultId: string;
  scope: KeyScope;
}

export async function resolveApiKey(token: string): Promise<ResolvedKey | null> {
  const [row] = await db
    .select({
      id: schema.apiKeys.id,
      vaultId: schema.apiKeys.vaultId,
      scope: schema.apiKeys.scope,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tokenHash, hashToken(token)));
  if (!row) return null;
  // Fire-and-forget freshness marker; failures must not fail the request.
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => {});
  return row;
}

export async function listApiKeys(vaultId: string) {
  return db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      scope: schema.apiKeys.scope,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.vaultId, vaultId))
    .orderBy(schema.apiKeys.createdAt);
}

export async function deleteApiKey(vaultId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.apiKeys)
    .where(and(eq(schema.apiKeys.vaultId, vaultId), eq(schema.apiKeys.id, keyId)))
    .returning({ id: schema.apiKeys.id });
  return rows.length > 0;
}
