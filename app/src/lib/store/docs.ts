import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { db, schema } from "../db";
import { slugify } from "../parse";
import { claimDanglingEdges, runSavePipeline } from "../save";
import { appendUpdate, replaceText, TEXT_KEY } from "../yjs/store";

// Doc lifecycle. Identity is the UUID; slugs are addresses that can move
// (leaving redirects), never identity. spec: docs/model/L1-model#doc-identity

/** Doc size cap — a caller-controlled input gets a ceiling before P5's
 *  broader hardening. spec: docs/platform/L1-platform#input-caps */
export const MAX_DOC_BYTES = 1_000_000;

const SUFFIX_ATTEMPTS = 50;

export type DocError = "slug-taken" | "doc-too-large" | "not-found";

export interface DocRow {
  id: string;
  vaultId: string;
  slug: string;
}

function isUniqueViolation(e: unknown): boolean {
  for (let err: unknown = e; err instanceof Error; err = err.cause) {
    if ("code" in err && (err as { code?: string }).code === "23505") return true;
  }
  return false;
}

/** A slug becoming live shadows any redirect parked on it and claims
 *  dangling links held under its name. */
async function slugBecameLive(vaultId: string, slug: string, docId: string): Promise<void> {
  await db
    .delete(schema.redirects)
    .where(and(eq(schema.redirects.vaultId, vaultId), eq(schema.redirects.oldSlug, slug)));
  await claimDanglingEdges(vaultId, slug, docId);
}

export async function createDoc(
  vaultId: string,
  input: { slug?: string; title?: string; text?: string },
): Promise<DocRow | { error: DocError }> {
  const text = input.text ?? "";
  if (Buffer.byteLength(text) > MAX_DOC_BYTES) return { error: "doc-too-large" };
  const explicit = input.slug !== undefined;
  const base = slugify(input.slug ?? input.title ?? "untitled");

  // Insert-and-catch rather than check-then-insert: the unique index is
  // the arbiter, concurrent creates just move to the next suffix.
  // spec: docs/model/L1-model#slug-unique
  let doc: DocRow | null = null;
  for (let n = 1; n <= SUFFIX_ATTEMPTS && !doc; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    try {
      const [row] = await db
        .insert(schema.docs)
        .values({ vaultId, slug: candidate })
        .returning({ id: schema.docs.id, vaultId: schema.docs.vaultId, slug: schema.docs.slug });
      doc = row!;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (explicit) return { error: "slug-taken" };
    }
  }
  if (!doc) return { error: "slug-taken" };

  // Seed the CRDT with the initial text, then derive.
  const ydoc = new Y.Doc();
  if (text.length > 0) ydoc.getText(TEXT_KEY).insert(0, text);
  await appendUpdate(doc.id, Y.encodeStateAsUpdate(ydoc));
  await runSavePipeline(doc, text);
  await slugBecameLive(vaultId, doc.slug, doc.id);
  return doc;
}

/** Renaming mints a redirect from the old slug and re-points any redirects
 *  already aimed at this doc's history. spec: docs/model/L1-model#rename-redirect */
export async function renameDoc(
  doc: DocRow,
  newSlugInput: string,
): Promise<{ slug: string } | { error: DocError }> {
  const newSlug = slugify(newSlugInput);
  if (newSlug === doc.slug) return { slug: newSlug };
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.docs)
        .set({ slug: newSlug, updatedAt: new Date() })
        .where(eq(schema.docs.id, doc.id));
      await tx
        .insert(schema.redirects)
        .values({ vaultId: doc.vaultId, oldSlug: doc.slug, docId: doc.id })
        .onConflictDoUpdate({
          target: [schema.redirects.vaultId, schema.redirects.oldSlug],
          set: { docId: doc.id },
        });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "slug-taken" };
    throw e;
  }
  await slugBecameLive(doc.vaultId, newSlug, doc.id);
  return { slug: newSlug };
}

/** Whole-text write through the CRDT (the API door). */
export async function writeDocText(
  doc: DocRow,
  text: string,
): Promise<{ ok: true } | { error: DocError }> {
  if (Buffer.byteLength(text) > MAX_DOC_BYTES) return { error: "doc-too-large" };
  await replaceText(doc.id, text);
  await runSavePipeline(doc, text);
  return { ok: true };
}

export async function getDoc(vaultId: string, docId: string) {
  const [doc] = await db
    .select()
    .from(schema.docs)
    .where(and(eq(schema.docs.id, docId), eq(schema.docs.vaultId, vaultId)));
  return doc ?? null;
}

/** Live slug first, then redirects. spec: docs/model/L1-model#rename-redirect */
export async function resolveSlug(vaultId: string, slug: string) {
  const [live] = await db
    .select()
    .from(schema.docs)
    .where(and(eq(schema.docs.vaultId, vaultId), eq(schema.docs.slug, slug)));
  if (live) return { doc: live, redirected: false };
  const [redirect] = await db
    .select()
    .from(schema.redirects)
    .where(and(eq(schema.redirects.vaultId, vaultId), eq(schema.redirects.oldSlug, slug)));
  if (!redirect) return null;
  const [doc] = await db.select().from(schema.docs).where(eq(schema.docs.id, redirect.docId));
  return doc ? { doc, redirected: true } : null;
}

export async function listDocs(vaultId: string) {
  return db
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      tags: schema.docs.tags,
      visibility: schema.docs.visibility,
      updatedAt: schema.docs.updatedAt,
    })
    .from(schema.docs)
    .where(eq(schema.docs.vaultId, vaultId))
    .orderBy(schema.docs.updatedAt);
}

export async function deleteDoc(docId: string): Promise<void> {
  // Cascades take updates, outgoing edges, usages, and redirects; incoming
  // edges revert to dangling (FK set null). spec: docs/model/L1-model#link-dangling
  await db.delete(schema.docs).where(eq(schema.docs.id, docId));
}

export async function setVisibility(
  docId: string,
  visibility: "private" | "unlisted" | "public",
): Promise<void> {
  await db
    .update(schema.docs)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(schema.docs.id, docId));
}
