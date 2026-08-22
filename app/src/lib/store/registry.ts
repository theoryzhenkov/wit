import { and, eq, inArray } from "drizzle-orm";
import { emitChange } from "../bus";
import { db, schema } from "../db";

// The registry write path — `wit components sync` is its only caller.
// Reconciles the registry to the pushed manifest set: additions, prop
// updates, pruning of unmapped manifests — warning loudly when a pruned
// or prop-changed component still has usages.
// spec: docs/platform/L1-platform#sync-reconcile / #sync-drift-warn
// spec: docs/model/L1-model#registry-manifests

export interface ManifestInput {
  name: string;
  description?: string;
  props?: Record<string, unknown>;
  slots?: unknown;
}

export interface DriftWarning {
  name: string;
  reason: "pruned" | "props-changed";
  usageCount: number;
  docSlugs: string[];
}

export interface ReconcileResult {
  added: string[];
  updated: string[];
  pruned: string[];
  warnings: DriftWarning[];
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const MAX_MANIFESTS = 500;

export function validateManifests(input: unknown): ManifestInput[] | null {
  if (!Array.isArray(input) || input.length > MAX_MANIFESTS) return null;
  const seen = new Set<string>();
  const out: ManifestInput[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const m = raw as ManifestInput;
    if (typeof m.name !== "string" || !NAME_RE.test(m.name) || seen.has(m.name)) return null;
    if (m.description !== undefined && typeof m.description !== "string") return null;
    if (m.props !== undefined && (typeof m.props !== "object" || Array.isArray(m.props))) {
      return null;
    }
    seen.add(m.name);
    out.push(m);
  }
  return out;
}

async function usageWarning(
  vaultId: string,
  name: string,
  reason: DriftWarning["reason"],
): Promise<DriftWarning | null> {
  const uses = await db
    .select({ slug: schema.docs.slug })
    .from(schema.componentUsages)
    .innerJoin(schema.docs, eq(schema.componentUsages.docId, schema.docs.id))
    .where(
      and(eq(schema.componentUsages.vaultId, vaultId), eq(schema.componentUsages.name, name)),
    );
  if (uses.length === 0) return null;
  const docSlugs = [...new Set(uses.map((u) => u.slug))].sort();
  return { name, reason, usageCount: uses.length, docSlugs };
}

export async function reconcileRegistry(
  vaultId: string,
  manifests: ManifestInput[],
): Promise<ReconcileResult> {
  const existing = await db
    .select()
    .from(schema.componentManifests)
    .where(eq(schema.componentManifests.vaultId, vaultId));
  const existingByName = new Map(existing.map((m) => [m.name, m]));
  const incomingNames = new Set(manifests.map((m) => m.name));

  const added: string[] = [];
  const updated: string[] = [];
  const warnings: DriftWarning[] = [];

  for (const m of manifests) {
    const props = m.props ?? {};
    const current = existingByName.get(m.name);
    if (!current) {
      added.push(m.name);
    } else if (JSON.stringify(current.props) !== JSON.stringify(props)) {
      updated.push(m.name);
      const warning = await usageWarning(vaultId, m.name, "props-changed");
      if (warning) warnings.push(warning);
    }
    await db
      .insert(schema.componentManifests)
      .values({
        vaultId,
        name: m.name,
        description: m.description ?? "",
        props,
        slots: m.slots ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.componentManifests.vaultId, schema.componentManifests.name],
        set: {
          description: m.description ?? "",
          props,
          slots: m.slots ?? null,
          syncedAt: new Date(),
        },
      });
  }

  const pruned = existing.map((m) => m.name).filter((name) => !incomingNames.has(name));
  for (const name of pruned) {
    const warning = await usageWarning(vaultId, name, "pruned");
    if (warning) warnings.push(warning);
  }
  if (pruned.length > 0) {
    await db
      .delete(schema.componentManifests)
      .where(
        and(
          eq(schema.componentManifests.vaultId, vaultId),
          inArray(schema.componentManifests.name, pruned),
        ),
      );
  }

  const touched = [...added, ...updated, ...pruned];
  if (touched.length > 0) emitChange(vaultId, "components", touched);
  return { added, updated, pruned, warnings };
}
