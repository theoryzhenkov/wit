import { and, eq, inArray, isNull } from "drizzle-orm";
import { emitChange } from "./bus";
import { db, schema } from "./db";
import { parseDoc } from "./parse";
import { deriveText, loadYDoc } from "./yjs/store";

// The save pipeline: doc text → derived indexes, in one transaction.
// derive text → parse frontmatter/tags → resolve links → replace edges →
// parse directives → replace usages. Re-running it is always safe: every
// derived table is replaced wholesale from the current text.
// spec: docs/model/L1-model#text-is-truth

interface DocCoords {
  id: string;
  vaultId: string;
  slug: string;
}

/** Resolve target slugs to doc UUIDs: live slugs first, then redirects
 *  (an old slug resolves to the doc). spec: docs/model/L1-model#link-resolve */
async function resolveSlugs(vaultId: string, slugs: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (slugs.length === 0) return resolved;
  const live = await db
    .select({ id: schema.docs.id, slug: schema.docs.slug })
    .from(schema.docs)
    .where(and(eq(schema.docs.vaultId, vaultId), inArray(schema.docs.slug, slugs)));
  for (const row of live) resolved.set(row.slug, row.id);
  const missing = slugs.filter((s) => !resolved.has(s));
  if (missing.length > 0) {
    const redirected = await db
      .select({ docId: schema.redirects.docId, oldSlug: schema.redirects.oldSlug })
      .from(schema.redirects)
      .where(and(eq(schema.redirects.vaultId, vaultId), inArray(schema.redirects.oldSlug, missing)));
    for (const row of redirected) resolved.set(row.oldSlug, row.docId);
  }
  return resolved;
}

export async function runSavePipeline(doc: DocCoords, text: string): Promise<void> {
  const parsed = parseDoc(text, doc.slug);
  const targetSlugs = [
    ...new Set([...parsed.links, ...parsed.relations.map((r) => r.targetSlug)]),
  ];
  const resolved = await resolveSlugs(doc.vaultId, targetSlugs);

  const edgeRows = [
    ...parsed.links.map((slug) => ({
      vaultId: doc.vaultId,
      sourceDocId: doc.id,
      kind: "wikilink" as const,
      rel: null,
      targetSlug: slug,
      targetDocId: resolved.get(slug) ?? null,
    })),
    ...parsed.relations.map((r) => ({
      vaultId: doc.vaultId,
      sourceDocId: doc.id,
      kind: "relation" as const,
      rel: r.rel,
      targetSlug: r.targetSlug,
      targetDocId: resolved.get(r.targetSlug) ?? null,
    })),
  ];
  const usageRows = parsed.usages.map((u) => ({
    vaultId: doc.vaultId,
    docId: doc.id,
    name: u.name,
    props: u.props,
  }));

  await db.transaction(async (tx) => {
    await tx
      .update(schema.docs)
      .set({
        text,
        title: parsed.title,
        frontmatter: parsed.frontmatter,
        tags: parsed.tags,
        updatedAt: new Date(),
      })
      .where(eq(schema.docs.id, doc.id));
    await tx.delete(schema.edges).where(eq(schema.edges.sourceDocId, doc.id));
    if (edgeRows.length > 0) await tx.insert(schema.edges).values(edgeRows);
    await tx.delete(schema.componentUsages).where(eq(schema.componentUsages.docId, doc.id));
    if (usageRows.length > 0) await tx.insert(schema.componentUsages).values(usageRows);
  });

  // After commit: consumers drop caches and refetch.
  // spec: docs/platform/L1-platform#sse-feed
  emitChange(doc.vaultId, "docs", [doc.id]);
  emitChange(doc.vaultId, "edges", [doc.id]);
  emitChange(doc.vaultId, "usages", [doc.id]);
}

/** Full save from CRDT state: the relay's and API door's common path.
 *  spec: docs/platform/L1-platform#yjs-persist — derived markdown is
 *  recomputed from doc state and never diverges. */
export async function saveDocFromYDoc(docId: string): Promise<void> {
  const [doc] = await db
    .select({ id: schema.docs.id, vaultId: schema.docs.vaultId, slug: schema.docs.slug })
    .from(schema.docs)
    .where(eq(schema.docs.id, docId));
  if (!doc) return; // deleted mid-flight; nothing to derive
  const ydoc = await loadYDoc(docId);
  await runSavePipeline(doc, deriveText(ydoc));
}

/** A slug just became live (doc created or renamed): dangling edges held
 *  under that name attach to it. spec: docs/model/L1-model#link-dangling */
export async function claimDanglingEdges(
  vaultId: string,
  slug: string,
  docId: string,
): Promise<void> {
  const claimed = await db
    .update(schema.edges)
    .set({ targetDocId: docId })
    .where(
      and(
        eq(schema.edges.vaultId, vaultId),
        eq(schema.edges.targetSlug, slug),
        isNull(schema.edges.targetDocId),
      ),
    )
    .returning({ sourceDocId: schema.edges.sourceDocId });
  emitChange(
    vaultId,
    "edges",
    [...new Set(claimed.map((e) => e.sourceDocId))],
  );
}
