import { SQL, and, asc, desc, eq, sql } from "drizzle-orm";
import { emitChange } from "../bus";
import { db, schema } from "../db";
import { slugify } from "../parse";

// Collections: views, never containers. Effective membership =
// rule matches ∪ pins − excludes; pins carry explicit order, rule
// matches follow the collection's sort key.
// spec: docs/model/L1-model#collection-algebra / #collection-order

export interface RuleFilter {
  on: string; // "tags" | "fm.<key>" | "text"
  op: string; // tags: contains; fm: eq | exists; text: fts
  value?: unknown;
}

export interface Rule {
  filters: RuleFilter[];
}

export type CollectionError = "slug-taken" | "bad-rule" | "bad-sort" | "not-found";

const SORT_KEYS = {
  updated: schema.docs.updatedAt,
  created: schema.docs.createdAt,
  slug: schema.docs.slug,
  title: schema.docs.title,
} as const;

export const DEFAULT_SORT = "updated.desc";

/** Rules are parsed at write time — a stored rule is always executable,
 *  and always compiles to indexed SQL (same fence as the grammar).
 *  spec: docs/platform/L1-platform#grammar-indexed */
export function validateRule(input: unknown): Rule | null {
  if (input === null) return null;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const filters = (input as { filters?: unknown }).filters;
  if (!Array.isArray(filters) || filters.length > 20) return null;
  for (const f of filters) {
    if (typeof f !== "object" || f === null) return null;
    const { on, op, value } = f as RuleFilter;
    if (on === "tags" && op === "contains" && typeof value === "string") continue;
    if (typeof on === "string" && on.startsWith("fm.") && on.length > 3 && op === "eq") continue;
    if (typeof on === "string" && on.startsWith("fm.") && on.length > 3 && op === "exists") continue;
    if (on === "text" && op === "fts" && typeof value === "string") continue;
    return null;
  }
  return { filters: filters as RuleFilter[] };
}

export function validateSortKey(input: string): boolean {
  const m = input.match(/^([a-z]+)\.(asc|desc)$/);
  return !!m && m[1]! in SORT_KEYS;
}

function compileRule(rule: Rule): SQL[] {
  return rule.filters.map((f) => {
    if (f.on === "tags") return sql`${schema.docs.tags} @> array[${f.value}]::text[]`;
    if (f.on === "text")
      return sql`${schema.docs.searchVec} @@ websearch_to_tsquery('english', ${f.value})`;
    const key = f.on.slice(3);
    if (f.op === "exists") return sql`${schema.docs.frontmatter} ? ${key}`;
    return sql`${schema.docs.frontmatter} @> ${JSON.stringify({ [key]: f.value })}::jsonb`;
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────

export async function createCollection(
  vaultId: string,
  input: { slug: string; name?: string; rule?: unknown; sortKey?: string },
): Promise<{ id: string; slug: string } | { error: CollectionError }> {
  const slug = slugify(input.slug);
  const rule = input.rule === undefined ? null : validateRule(input.rule);
  if (input.rule !== undefined && input.rule !== null && rule === null) {
    return { error: "bad-rule" };
  }
  const sortKey = input.sortKey ?? DEFAULT_SORT;
  if (!validateSortKey(sortKey)) return { error: "bad-sort" };
  try {
    const [row] = await db
      .insert(schema.collections)
      .values({ vaultId, slug, name: input.name ?? "", rule, sortKey })
      .returning({ id: schema.collections.id, slug: schema.collections.slug });
    emitChange(vaultId, "collections", [row!.id]);
    return row!;
  } catch (e) {
    for (let err: unknown = e; err instanceof Error; err = err.cause) {
      if ("code" in err && (err as { code?: string }).code === "23505") {
        return { error: "slug-taken" };
      }
    }
    throw e;
  }
}

export async function updateCollection(
  vaultId: string,
  collectionId: string,
  input: { name?: string; rule?: unknown; sortKey?: string },
): Promise<{ ok: true } | { error: CollectionError }> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set["name"] = input.name;
  if (input.rule !== undefined) {
    const rule = validateRule(input.rule);
    if (input.rule !== null && rule === null) return { error: "bad-rule" };
    set["rule"] = rule;
  }
  if (input.sortKey !== undefined) {
    if (!validateSortKey(input.sortKey)) return { error: "bad-sort" };
    set["sortKey"] = input.sortKey;
  }
  const rows = await db
    .update(schema.collections)
    .set(set)
    .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.vaultId, vaultId)))
    .returning({ id: schema.collections.id });
  if (rows.length === 0) return { error: "not-found" };
  emitChange(vaultId, "collections", [collectionId]);
  emitChange(vaultId, "membership", [collectionId]);
  return { ok: true };
}

export async function deleteCollection(vaultId: string, collectionId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.vaultId, vaultId)))
    .returning({ id: schema.collections.id });
  if (rows.length > 0) emitChange(vaultId, "collections", [collectionId]);
  return rows.length > 0;
}

export async function getCollectionBySlug(vaultId: string, slug: string) {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.vaultId, vaultId), eq(schema.collections.slug, slug)));
  return row ?? null;
}

// ── Pins & excludes ───────────────────────────────────────────────────

/** Upsert a pin (with position) or an exclude. One row per (collection,
 *  doc): re-pinning moves it, excluding overrides a pin.
 *  spec: docs/model/L1-model#collection-order */
export async function setItem(
  vaultId: string,
  collectionId: string,
  docId: string,
  kind: "pin" | "exclude",
  position?: number,
): Promise<{ ok: true } | { error: "bad-position" | "not-found" }> {
  if (kind === "pin" && (position === undefined || !Number.isInteger(position))) {
    return { error: "bad-position" };
  }
  const [collection] = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.vaultId, vaultId)));
  const [doc] = await db
    .select({ id: schema.docs.id })
    .from(schema.docs)
    .where(and(eq(schema.docs.id, docId), eq(schema.docs.vaultId, vaultId)));
  if (!collection || !doc) return { error: "not-found" };

  await db
    .insert(schema.collectionItems)
    .values({ collectionId, docId, kind, position: kind === "pin" ? position! : null })
    .onConflictDoUpdate({
      target: [schema.collectionItems.collectionId, schema.collectionItems.docId],
      set: { kind, position: kind === "pin" ? position! : null },
    });
  emitChange(vaultId, "membership", [collectionId]);
  return { ok: true };
}

export async function removeItem(
  vaultId: string,
  collectionId: string,
  docId: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.collectionItems)
    .where(
      and(
        eq(schema.collectionItems.collectionId, collectionId),
        eq(schema.collectionItems.docId, docId),
      ),
    )
    .returning({ docId: schema.collectionItems.docId });
  if (rows.length > 0) emitChange(vaultId, "membership", [collectionId]);
  return rows.length > 0;
}

// ── The algebra ───────────────────────────────────────────────────────

export interface MemberEntry {
  docId: string;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  kind: "pin" | "rule";
  position: number | null;
}

/** Effective membership = pins (explicit order) ++ rule matches (sort
 *  key order) − excludes, deduped (a pinned rule-match appears once, at
 *  its pin position). spec: docs/model/L1-model#collection-algebra */
export async function effectiveMembership(
  vaultId: string,
  collection: {
    id: string;
    rule: unknown;
    sortKey: string | null;
  },
  opts: { publicOnly: boolean },
): Promise<MemberEntry[]> {
  const visible = opts.publicOnly ? [eq(schema.docs.visibility, "public")] : [];

  const pinned = await db
    .select({
      docId: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      visibility: schema.docs.visibility,
      position: schema.collectionItems.position,
    })
    .from(schema.collectionItems)
    .innerJoin(schema.docs, eq(schema.collectionItems.docId, schema.docs.id))
    .where(
      and(
        eq(schema.collectionItems.collectionId, collection.id),
        eq(schema.collectionItems.kind, "pin"),
        ...visible,
      ),
    )
    .orderBy(asc(schema.collectionItems.position), asc(schema.docs.slug));

  const entries: MemberEntry[] = pinned.map((p) => ({
    docId: p.docId,
    slug: p.slug,
    title: p.title,
    visibility: p.visibility,
    kind: "pin",
    position: p.position,
  }));

  const rule = collection.rule ? validateRule(collection.rule) : null;
  if (rule) {
    const sortRaw = collection.sortKey ?? DEFAULT_SORT;
    const m = sortRaw.match(/^([a-z]+)\.(asc|desc)$/);
    const sortCol = SORT_KEYS[(m?.[1] ?? "updated") as keyof typeof SORT_KEYS];
    const sortDir = m?.[2] === "asc" ? asc : desc;

    // Excludes and already-pinned docs drop out of the rule matches.
    const matches = await db
      .select({
        docId: schema.docs.id,
        slug: schema.docs.slug,
        title: schema.docs.title,
        visibility: schema.docs.visibility,
      })
      .from(schema.docs)
      .where(
        and(
          eq(schema.docs.vaultId, vaultId),
          ...compileRule(rule),
          ...visible,
          sql`${schema.docs.id} not in (
            select ${schema.collectionItems.docId} from ${schema.collectionItems}
            where ${schema.collectionItems.collectionId} = ${collection.id}
          )`,
        ),
      )
      .orderBy(sortDir(sortCol), asc(schema.docs.id));

    for (const d of matches) {
      entries.push({
        docId: d.docId,
        slug: d.slug,
        title: d.title,
        visibility: d.visibility,
        kind: "rule",
        position: null,
      });
    }
  }

  return entries;
}
