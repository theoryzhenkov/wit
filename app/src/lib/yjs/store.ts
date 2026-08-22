import * as Y from "yjs";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";

// Yjs persistence: an append-only update log per doc, compacted once it
// grows past a threshold. The Y.Doc is the doc's authoritative state;
// the docs.text column is derived from it on save.
// spec: docs/platform/L1-platform#yjs-persist

/** The one shared Y.Text key all clients edit. */
export const TEXT_KEY = "content";

const COMPACT_THRESHOLD = 64;

export function deriveText(ydoc: Y.Doc): string {
  return ydoc.getText(TEXT_KEY).toString();
}

/** All persisted updates for a doc merged into one, or null if none. */
export async function loadDocState(docId: string): Promise<Uint8Array | null> {
  const rows = await db
    .select({ update: schema.docUpdates.update })
    .from(schema.docUpdates)
    .where(eq(schema.docUpdates.docId, docId))
    .orderBy(asc(schema.docUpdates.seq));
  if (rows.length === 0) return null;
  return Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)));
}

export async function loadYDoc(docId: string): Promise<Y.Doc> {
  const ydoc = new Y.Doc();
  const state = await loadDocState(docId);
  if (state) Y.applyUpdate(ydoc, state);
  return ydoc;
}

export async function appendUpdate(docId: string, update: Uint8Array): Promise<void> {
  await db.insert(schema.docUpdates).values({ docId, update: Buffer.from(update) });
  await compactIfNeeded(docId);
}

async function compactIfNeeded(docId: string): Promise<void> {
  const rows = await db
    .select({ seq: schema.docUpdates.seq })
    .from(schema.docUpdates)
    .where(eq(schema.docUpdates.docId, docId));
  if (rows.length >= COMPACT_THRESHOLD) await compact(docId);
}

/** Folds all current update rows into one. Rows are locked and only the
 *  ones read are deleted, so an update appended mid-compaction survives. */
export async function compact(docId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ seq: schema.docUpdates.seq, update: schema.docUpdates.update })
      .from(schema.docUpdates)
      .where(eq(schema.docUpdates.docId, docId))
      .orderBy(asc(schema.docUpdates.seq))
      .for("update");
    if (rows.length <= 1) return;
    const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)));
    await tx.delete(schema.docUpdates).where(
      inArray(
        schema.docUpdates.seq,
        rows.map((r) => r.seq),
      ),
    );
    await tx.insert(schema.docUpdates).values({ docId, update: Buffer.from(merged) });
  });
}

/** Number of stored update rows (compaction observability, tests). */
export async function updateRowCount(docId: string): Promise<number> {
  const rows = await db
    .select({ seq: schema.docUpdates.seq })
    .from(schema.docUpdates)
    .where(eq(schema.docUpdates.docId, docId));
  return rows.length;
}

/** Whole-text replace as a CRDT transaction — the API door's write path.
 *  Returns the update that encodes the change, already persisted. */
export async function replaceText(docId: string, text: string): Promise<Uint8Array> {
  const ydoc = await loadYDoc(docId);
  let captured: Uint8Array | null = null;
  ydoc.on("update", (u: Uint8Array) => {
    captured = u;
  });
  ydoc.transact(() => {
    const ytext = ydoc.getText(TEXT_KEY);
    ytext.delete(0, ytext.length);
    if (text.length > 0) ytext.insert(0, text);
  });
  if (captured) await appendUpdate(docId, captured);
  return captured ?? new Uint8Array();
}
