import { SQL, and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";

// The query grammar: one uniform surface over the seven nouns. Filters
// compile to indexed SQL or the query is rejected — nothing scans.
// spec: docs/platform/L1-platform#grammar-nouns / #grammar-indexed
//
// Syntax (PostgREST lineage): ?field=op.value with ops eq | in | prefix |
// contains | exists, plus fts=<query>, order=<key>.<asc|desc>,
// limit, cursor, include=body,backlinks.

export type Principal = { kind: "member" | "write" | "read"; vaultId: string };

export class GrammarError extends Error {}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

interface Cond {
  field: string;
  op: string;
  value: string;
}

export interface ParsedQuery {
  conds: Cond[];
  fts: string | null;
  order: { key: string; dir: "asc" | "desc" } | null;
  limit: number;
  cursor: string | null;
  includes: Set<string>;
}

const RESERVED = new Set(["fts", "order", "limit", "cursor", "include"]);
const OPS = new Set(["eq", "in", "prefix", "contains", "exists"]);

export function parseQuery(params: URLSearchParams): ParsedQuery {
  const conds: Cond[] = [];
  for (const [field, raw] of params.entries()) {
    if (RESERVED.has(field)) continue;
    const dot = raw.indexOf(".");
    const op = dot === -1 ? raw : raw.slice(0, dot);
    const value = dot === -1 ? "" : raw.slice(dot + 1);
    if (!OPS.has(op)) throw new GrammarError(`unknown operator ${JSON.stringify(op)} on ${field}`);
    if (op !== "exists" && value === "") throw new GrammarError(`missing value for ${field}`);
    conds.push({ field, op, value });
  }

  const fts = params.get("fts");
  const orderRaw = params.get("order");
  let order: ParsedQuery["order"] = null;
  if (orderRaw) {
    const m = orderRaw.match(/^([a-z_]+)\.(asc|desc)$/);
    if (!m) throw new GrammarError(`bad order ${JSON.stringify(orderRaw)}`);
    order = { key: m[1]!, dir: m[2] as "asc" | "desc" };
  }

  const limitRaw = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new GrammarError(`limit must be 1–${MAX_LIMIT}`);
    }
  }

  const includes = new Set((params.get("include") ?? "").split(",").filter(Boolean));
  return { conds, fts, order, limit, cursor: params.get("cursor"), includes };
}

// ── Cursor (keyset) ───────────────────────────────────────────────────

function encodeCursor(value: unknown, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Array.isArray(parsed) && parsed.length === 2) return [String(parsed[0]), String(parsed[1])];
  } catch {
    // fall through
  }
  throw new GrammarError("bad cursor");
}

// ── Shared helpers ────────────────────────────────────────────────────

function listValues(value: string): string[] {
  const items = value.split(",").filter(Boolean);
  if (items.length === 0 || items.length > 100) throw new GrammarError("bad in() list");
  return items;
}

/** Prefix as a btree-servable range — correct for the normalized ASCII
 *  slug/path charsets this grammar serves. */
function prefixRange(col: SQL | { getSQL(): SQL }, value: string): SQL {
  return sql`(${col} >= ${value} and ${col} < ${value + "￿"})`;
}

function jsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ── docs ──────────────────────────────────────────────────────────────

export interface DocsQueryResult {
  items: Record<string, unknown>[];
  next: string | null;
}

const DOC_ORDER_KEYS = {
  updated: schema.docs.updatedAt,
  created: schema.docs.createdAt,
  slug: schema.docs.slug,
  title: schema.docs.title,
} as const;

/** Visibility fence. Read keys: public everywhere; unlisted only as a
 *  direct slug fetch, never in listings or search.
 *  spec: docs/model/L1-model#visibility-tiers / #private-never-served */
function docVisibilityFence(principal: Principal, q: ParsedQuery): SQL | null {
  if (principal.kind !== "read") return null;
  const direct = q.conds.some((c) => c.field === "slug" && (c.op === "eq" || c.op === "in"));
  if (direct && !q.fts) {
    return sql`${schema.docs.visibility} in ('public', 'unlisted')`;
  }
  return eq(schema.docs.visibility, "public");
}

export async function queryDocs(principal: Principal, q: ParsedQuery): Promise<DocsQueryResult> {
  const where: (SQL | null)[] = [eq(schema.docs.vaultId, principal.vaultId)];

  for (const cond of q.conds) {
    const { field, op, value } = cond;
    if (field === "slug") {
      if (op === "eq") where.push(eq(schema.docs.slug, value));
      else if (op === "in") where.push(inArray(schema.docs.slug, listValues(value)));
      else if (op === "prefix") where.push(prefixRange(schema.docs.slug, value));
      else throw new GrammarError(`op ${op} not supported on slug`);
    } else if (field === "tags") {
      if (op === "contains") where.push(sql`${schema.docs.tags} @> array[${value}]::text[]`);
      else throw new GrammarError(`op ${op} not supported on tags (use contains)`);
    } else if (field === "visibility") {
      // Read keys may narrow to public (a no-op under their fence) so
      // clients can send one uniform query shape; anything else leaks.
      if (principal.kind === "read" && !(op === "eq" && value === "public")) {
        throw new GrammarError("visibility filter requires write access");
      }
      if (op === "eq") where.push(sql`${schema.docs.visibility} = ${value}`);
      else if (op === "in")
        where.push(sql`${schema.docs.visibility} = any(${listValues(value)}::visibility[])`);
      else throw new GrammarError(`op ${op} not supported on visibility`);
    } else if (field.startsWith("fm.")) {
      const key = field.slice(3);
      if (!key) throw new GrammarError("empty frontmatter key");
      if (op === "eq") {
        where.push(sql`${schema.docs.frontmatter} @> ${JSON.stringify({ [key]: jsonValue(value) })}::jsonb`);
      } else if (op === "exists") {
        where.push(sql`${schema.docs.frontmatter} ? ${key}`);
      } else throw new GrammarError(`op ${op} not supported on frontmatter fields`);
    } else {
      throw new GrammarError(`unknown docs field ${JSON.stringify(field)}`);
    }
  }

  // spec: docs/platform/L1-platform#fts-operator
  if (q.fts) {
    where.push(sql`${schema.docs.searchVec} @@ websearch_to_tsquery('english', ${q.fts})`);
  }

  where.push(docVisibilityFence(principal, q));

  const orderKey = (q.order?.key ?? "updated") as keyof typeof DOC_ORDER_KEYS;
  if (!Object.hasOwn(DOC_ORDER_KEYS, orderKey)) {
    throw new GrammarError(`unknown order key ${JSON.stringify(q.order?.key)}`);
  }
  const orderCol = DOC_ORDER_KEYS[orderKey];
  const dir = q.order?.dir ?? "desc";

  if (q.cursor) {
    const [v, id] = decodeCursor(q.cursor);
    const cmp = dir === "asc" ? sql`>` : sql`<`;
    where.push(sql`(${orderCol}, ${schema.docs.id}) ${cmp} (${v}, ${id}::uuid)`);
  }

  const rows = await db
    .select()
    .from(schema.docs)
    .where(and(...where.filter((w): w is SQL => w !== null)))
    .orderBy(dir === "asc" ? asc(orderCol) : desc(orderCol), dir === "asc" ? asc(schema.docs.id) : desc(schema.docs.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const withBody = q.includes.has("body");

  const items: Record<string, unknown>[] = page.map((d) => ({
    id: d.id,
    slug: d.slug,
    title: d.title,
    tags: d.tags,
    frontmatter: d.frontmatter,
    visibility: d.visibility,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    // spec: docs/platform/L1-platform#markdown-out — raw markdown, no HTML
    ...(withBody ? { text: d.text } : {}),
  }));

  // spec: docs/platform/L1-platform#sdk-client-side — backlinks are just
  // an edge read folded into the response, not a capability endpoint.
  if (q.includes.has("backlinks") && page.length > 0) {
    const ids = page.map((d) => d.id);
    const sourceVisible =
      principal.kind === "read" ? eq(schema.docs.visibility, "public") : null;
    const backlinks = await db
      .select({
        sourceId: schema.edges.sourceDocId,
        sourceSlug: schema.docs.slug,
        targetId: schema.edges.targetDocId,
        kind: schema.edges.kind,
        rel: schema.edges.rel,
      })
      .from(schema.edges)
      .innerJoin(schema.docs, eq(schema.edges.sourceDocId, schema.docs.id))
      .where(
        and(
          inArray(schema.edges.targetDocId, ids),
          ...(sourceVisible ? [sourceVisible] : []),
        ),
      );
    const byTarget = new Map<string, unknown[]>();
    for (const b of backlinks) {
      const list = byTarget.get(b.targetId!) ?? [];
      list.push({ sourceId: b.sourceId, sourceSlug: b.sourceSlug, kind: b.kind, rel: b.rel });
      byTarget.set(b.targetId!, list);
    }
    for (const item of items) {
      item["backlinks"] = byTarget.get(item["id"] as string) ?? [];
    }
  }

  const next =
    rows.length > q.limit
      ? encodeCursor(
          page[page.length - 1]![
            orderKey === "updated" ? "updatedAt" : orderKey === "created" ? "createdAt" : orderKey
          ],
          page[page.length - 1]!.id,
        )
      : null;
  return { items, next };
}

// ── collections ───────────────────────────────────────────────────────

export async function queryCollections(principal: Principal, q: ParsedQuery) {
  const where: SQL[] = [eq(schema.collections.vaultId, principal.vaultId)];
  for (const { field, op, value } of q.conds) {
    if (field !== "slug") throw new GrammarError(`unknown collections field ${JSON.stringify(field)}`);
    if (op === "eq") where.push(eq(schema.collections.slug, value));
    else if (op === "in") where.push(inArray(schema.collections.slug, listValues(value)));
    else if (op === "prefix") where.push(prefixRange(schema.collections.slug, value));
    else throw new GrammarError(`op ${op} not supported on slug`);
  }
  if (q.fts || q.order) throw new GrammarError("collections support neither fts nor order");
  if (q.cursor) {
    const [v] = decodeCursor(q.cursor);
    where.push(sql`${schema.collections.slug} > ${v}`);
  }
  const rows = await db
    .select({
      id: schema.collections.id,
      slug: schema.collections.slug,
      name: schema.collections.name,
      rule: schema.collections.rule,
      sortKey: schema.collections.sortKey,
    })
    .from(schema.collections)
    .where(and(...where))
    .orderBy(asc(schema.collections.slug))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    items: page,
    next: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.slug, "") : null,
  };
}

// ── edges ─────────────────────────────────────────────────────────────

export async function queryEdges(principal: Principal, q: ParsedQuery) {
  const where: SQL[] = [eq(schema.edges.vaultId, principal.vaultId)];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const KINDS = ["wikilink", "relation"] as const;
  for (const { field, op, value } of q.conds) {
    if (op !== "eq" && op !== "in") {
      throw new GrammarError(`op ${op} not supported on edges.${field}`);
    }
    const values = op === "in" ? listValues(value) : [value];
    if (field === "source" || field === "target") {
      if (!values.every((v) => UUID_RE.test(v))) throw new GrammarError(`${field} must be a uuid`);
      const col = field === "source" ? schema.edges.sourceDocId : schema.edges.targetDocId;
      where.push(inArray(col, values));
    } else if (field === "slug") {
      where.push(inArray(schema.edges.targetSlug, values));
    } else if (field === "kind") {
      const kinds = values.filter((v): v is (typeof KINDS)[number] =>
        (KINDS as readonly string[]).includes(v),
      );
      if (kinds.length !== values.length) throw new GrammarError("kind must be wikilink|relation");
      where.push(inArray(schema.edges.kind, kinds));
    } else if (field === "rel") {
      where.push(inArray(schema.edges.rel, values));
    } else {
      throw new GrammarError(`unknown edges field ${JSON.stringify(field)}`);
    }
  }
  if (q.fts || q.order) throw new GrammarError("edges support neither fts nor order");

  // Never serve edges out of non-public sources to read keys.
  // spec: docs/model/L1-model#private-never-served
  const visible =
    principal.kind === "read"
      ? sql`${schema.edges.sourceDocId} in (select id from ${schema.docs} where ${schema.docs.vaultId} = ${principal.vaultId} and ${schema.docs.visibility} = 'public')`
      : null;
  if (visible) where.push(visible);

  if (q.cursor) {
    const [v, id] = decodeCursor(q.cursor);
    where.push(sql`(${schema.edges.createdAt}, ${schema.edges.id}) > (${v}, ${id}::uuid)`);
  }

  const rows = await db
    .select({
      id: schema.edges.id,
      source: schema.edges.sourceDocId,
      kind: schema.edges.kind,
      rel: schema.edges.rel,
      targetSlug: schema.edges.targetSlug,
      target: schema.edges.targetDocId,
      createdAt: schema.edges.createdAt,
    })
    .from(schema.edges)
    .where(and(...where))
    .orderBy(asc(schema.edges.createdAt), asc(schema.edges.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    items: page,
    next:
      rows.length > q.limit
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
  };
}

// ── assets ────────────────────────────────────────────────────────────

export async function queryAssets(principal: Principal, q: ParsedQuery) {
  const where: SQL[] = [eq(schema.assets.vaultId, principal.vaultId)];
  let direct = false;
  for (const { field, op, value } of q.conds) {
    if (field !== "path") throw new GrammarError(`unknown assets field ${JSON.stringify(field)}`);
    if (op === "eq") {
      direct = true;
      where.push(eq(schema.assets.path, value));
    } else if (op === "prefix") where.push(prefixRange(schema.assets.path, value));
    else throw new GrammarError(`op ${op} not supported on path`);
  }
  if (q.fts || q.order) throw new GrammarError("assets support neither fts nor order");
  if (principal.kind === "read") {
    // spec: docs/model/L1-model#asset-visibility
    where.push(
      direct
        ? sql`${schema.assets.visibility} in ('public', 'unlisted')`
        : sql`${schema.assets.visibility} = 'public'`,
    );
  }
  if (q.cursor) {
    const [v] = decodeCursor(q.cursor);
    where.push(sql`${schema.assets.path} > ${v}`);
  }
  const rows = await db
    .select({
      id: schema.assets.id,
      path: schema.assets.path,
      contentType: schema.assets.contentType,
      sizeBytes: schema.assets.sizeBytes,
      visibility: schema.assets.visibility,
      createdAt: schema.assets.createdAt,
    })
    .from(schema.assets)
    .where(and(...where))
    .orderBy(asc(schema.assets.path))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    items: page,
    next: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.path, "") : null,
  };
}

// ── components ────────────────────────────────────────────────────────

export async function queryComponents(principal: Principal, q: ParsedQuery) {
  const where: SQL[] = [eq(schema.componentManifests.vaultId, principal.vaultId)];
  for (const { field, op, value } of q.conds) {
    if (field !== "name") throw new GrammarError(`unknown components field ${JSON.stringify(field)}`);
    if (op === "eq") where.push(eq(schema.componentManifests.name, value));
    else if (op === "in") where.push(inArray(schema.componentManifests.name, listValues(value)));
    else throw new GrammarError(`op ${op} not supported on name`);
  }
  if (q.fts || q.order) throw new GrammarError("components support neither fts nor order");
  if (q.cursor) {
    const [v] = decodeCursor(q.cursor);
    where.push(sql`${schema.componentManifests.name} > ${v}`);
  }
  const rows = await db
    .select({
      name: schema.componentManifests.name,
      description: schema.componentManifests.description,
      props: schema.componentManifests.props,
      slots: schema.componentManifests.slots,
      syncedAt: schema.componentManifests.syncedAt,
    })
    .from(schema.componentManifests)
    .where(and(...where))
    .orderBy(asc(schema.componentManifests.name))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    items: page,
    next: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.name, "") : null,
  };
}

// ── usages ────────────────────────────────────────────────────────────

export async function queryUsages(principal: Principal, q: ParsedQuery) {
  const where: SQL[] = [eq(schema.componentUsages.vaultId, principal.vaultId)];
  for (const { field, op, value } of q.conds) {
    if (field === "name") {
      if (op === "eq") where.push(eq(schema.componentUsages.name, value));
      else if (op === "in") where.push(inArray(schema.componentUsages.name, listValues(value)));
      else throw new GrammarError(`op ${op} not supported on name`);
    } else if (field === "doc") {
      if (op !== "eq") throw new GrammarError(`op ${op} not supported on doc`);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
        throw new GrammarError("doc must be a uuid");
      }
      where.push(sql`${schema.componentUsages.docId} = ${value}`);
    } else throw new GrammarError(`unknown usages field ${JSON.stringify(field)}`);
  }
  if (q.fts || q.order) throw new GrammarError("usages support neither fts nor order");
  if (principal.kind === "read") {
    where.push(
      sql`${schema.componentUsages.docId} in (select id from ${schema.docs} where ${schema.docs.vaultId} = ${principal.vaultId} and ${schema.docs.visibility} = 'public')`,
    );
  }
  if (q.cursor) {
    const [, id] = decodeCursor(q.cursor);
    where.push(sql`${schema.componentUsages.id} > ${id}::uuid`);
  }
  const rows = await db
    .select({
      id: schema.componentUsages.id,
      docId: schema.componentUsages.docId,
      name: schema.componentUsages.name,
      props: schema.componentUsages.props,
    })
    .from(schema.componentUsages)
    .where(and(...where))
    .orderBy(asc(schema.componentUsages.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    items: page,
    next: rows.length > q.limit ? encodeCursor("", page[page.length - 1]!.id) : null,
  };
}
