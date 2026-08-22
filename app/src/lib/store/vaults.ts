import { eq } from "drizzle-orm";
import { db, schema } from "../db";

// Vault lifecycle. Creation writes the vault and its owner membership in
// one transaction, so a vault without an owner is never observable.
// spec: docs/model/L1-model#vault-owner

export interface VaultSummary {
  id: string;
  name: string;
  role: "owner" | "editor";
}

export async function createVault(userId: string, name: string): Promise<VaultSummary> {
  return db.transaction(async (tx) => {
    const [vault] = await tx
      .insert(schema.vaults)
      .values({ name })
      .returning({ id: schema.vaults.id, name: schema.vaults.name });
    if (!vault) throw new Error("vault insert returned no row");
    await tx.insert(schema.vaultMembers).values({
      vaultId: vault.id,
      userId,
      role: "owner",
    });
    return { ...vault, role: "owner" };
  });
}

/** The vaults this user is a member of. spec: docs/model/L1-model#vault-access */
export async function listVaults(userId: string): Promise<VaultSummary[]> {
  const rows = await db
    .select({
      id: schema.vaults.id,
      name: schema.vaults.name,
      role: schema.vaultMembers.role,
    })
    .from(schema.vaultMembers)
    .innerJoin(schema.vaults, eq(schema.vaultMembers.vaultId, schema.vaults.id))
    .where(eq(schema.vaultMembers.userId, userId))
    .orderBy(schema.vaults.createdAt);
  return rows;
}
