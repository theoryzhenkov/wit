import { describe, expect, it, beforeAll } from "bun:test";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { db, schema } from "./lib/db";
import { and, eq } from "drizzle-orm";
import {
  createDoc,
  deleteDoc,
  renameDoc,
  resolveSlug,
  writeDocText,
  type DocRow,
} from "./lib/store/docs";
import { compact, loadYDoc, deriveText, updateRowCount, replaceText } from "./lib/yjs/store";

// P1 doc core: docs round-trip through the CRDT with every derived index
// correct (EPH-PLAN-L1-v1 "P1 — doc core" exit criterion).

const f = fixtures("doccore");

let vaultId: string;

function asDoc(r: { id: string; vaultId: string; slug: string }): DocRow {
  return { id: r.id, vaultId: r.vaultId, slug: r.slug };
}

async function edgesFrom(docId: string) {
  return db
    .select({
      kind: schema.edges.kind,
      rel: schema.edges.rel,
      targetSlug: schema.edges.targetSlug,
      targetDocId: schema.edges.targetDocId,
    })
    .from(schema.edges)
    .where(eq(schema.edges.sourceDocId, docId))
    .orderBy(schema.edges.targetSlug);
}

beforeAll(async () => {
  await ensureMigrated();
  await f.reset(["u"]);
  const [v] = await db
    .insert(schema.vaults)
    .values({ name: f.vaultName("main") })
    .returning({ id: schema.vaults.id });
  vaultId = v!.id;
  await db.insert(schema.vaultMembers).values({ vaultId, userId: f.userId("u"), role: "owner" });
});

describe("doc creation", () => {
  // spec: docs/model/L1-model#text-is-truth — all indexes derived on save
  it("derives title, frontmatter, tags, edges, and usages from the text", async () => {
    const text = `---
title: Source Doc
tags: [garden]
up: "[[hub]]"
---

Links to [[existing-target]] and [[nowhere-yet]].

::hero{src="/x.png"}
`;
    const target = await createDoc(vaultId, { slug: "existing-target" });
    expect("error" in target).toBe(false);

    const created = await createDoc(vaultId, { slug: "source-doc", text });
    if ("error" in created) throw new Error(created.error);

    const [row] = await db.select().from(schema.docs).where(eq(schema.docs.id, created.id));
    expect(row!.title).toBe("Source Doc");
    expect(row!.tags).toEqual(["garden"]);
    expect(row!.frontmatter).toMatchObject({ title: "Source Doc" });
    expect(row!.text).toBe(text);

    // spec: docs/model/L1-model#link-resolve — existing target resolved
    const edges = await edgesFrom(created.id);
    const resolved = edges.find((e) => e.targetSlug === "existing-target");
    expect(resolved!.targetDocId).toBe((target as DocRow).id);

    // spec: docs/model/L1-model#link-dangling — missing target held by name
    const dangling = edges.find((e) => e.targetSlug === "nowhere-yet");
    expect(dangling!.targetDocId).toBeNull();

    // spec: docs/model/L1-model#edge-typed — frontmatter relation is typed
    const rel = edges.find((e) => e.kind === "relation");
    expect(rel!.rel).toBe("up");
    expect(rel!.targetSlug).toBe("hub");

    // spec: docs/model/L1-model#usage-index
    const usages = await db
      .select()
      .from(schema.componentUsages)
      .where(eq(schema.componentUsages.docId, created.id));
    expect(usages).toHaveLength(1);
    expect(usages[0]!.name).toBe("hero");
    expect(usages[0]!.props).toEqual({ src: "/x.png" });

    // The CRDT state and the derived text agree.
    // spec: docs/platform/L1-platform#yjs-persist
    const ydoc = await loadYDoc(created.id);
    expect(deriveText(ydoc)).toBe(text);
  });

  // spec: docs/model/L1-model#link-dangling — auto-resolve on creation
  it("resolves dangling links when the named doc appears", async () => {
    const source = await createDoc(vaultId, {
      slug: "dangler",
      text: "See [[appears-later]].",
    });
    if ("error" in source) throw new Error(source.error);

    const late = await createDoc(vaultId, { slug: "appears-later" });
    if ("error" in late) throw new Error(late.error);

    const edges = await edgesFrom(source.id);
    expect(edges[0]!.targetDocId).toBe(late.id);
  });

  // spec: docs/model/L1-model#slug-unique
  it("suffixes generated slugs on collision and rejects explicit duplicates", async () => {
    const first = await createDoc(vaultId, { title: "Twice Named" });
    const second = await createDoc(vaultId, { title: "Twice Named" });
    expect((first as DocRow).slug).toBe("twice-named");
    expect((second as DocRow).slug).toBe("twice-named-2");

    const explicit = await createDoc(vaultId, { slug: "twice-named" });
    expect(explicit).toEqual({ error: "slug-taken" });
  });

  // spec: docs/platform/L1-platform#input-caps
  it("rejects oversized docs", async () => {
    const big = "x".repeat(1_000_001);
    expect(await createDoc(vaultId, { slug: "too-big", text: big })).toEqual({
      error: "doc-too-large",
    });
  });
});

describe("rename", () => {
  // spec: docs/model/L1-model#rename-redirect + #doc-identity
  it("mints a redirect; the old slug resolves to the same doc", async () => {
    const created = await createDoc(vaultId, { slug: "old-name", text: "# Old" });
    if ("error" in created) throw new Error(created.error);

    const renamed = await renameDoc(asDoc(created), "new-name");
    expect(renamed).toEqual({ slug: "new-name" });

    const viaOld = await resolveSlug(vaultId, "old-name");
    expect(viaOld!.doc.id).toBe(created.id); // identity unchanged
    expect(viaOld!.redirected).toBe(true);
    const viaNew = await resolveSlug(vaultId, "new-name");
    expect(viaNew!.redirected).toBe(false);
  });

  it("keeps resolved edges pointing at the doc UUID across renames", async () => {
    const target = await createDoc(vaultId, { slug: "stable-target" });
    if ("error" in target) throw new Error(target.error);
    const source = await createDoc(vaultId, {
      slug: "rename-witness",
      text: "link [[stable-target]]",
    });
    if ("error" in source) throw new Error(source.error);

    await renameDoc(asDoc(target), "moved-target");

    // spec: docs/model/L1-model#doc-identity — edge still holds the UUID
    const edges = await edgesFrom(source.id);
    expect(edges[0]!.targetDocId).toBe(target.id);
  });

  // spec: docs/model/L1-model#link-resolve — new links through redirects
  it("resolves new links written against the old slug via the redirect", async () => {
    const target = await createDoc(vaultId, { slug: "was-here" });
    if ("error" in target) throw new Error(target.error);
    await renameDoc(asDoc(target), "now-there");

    const source = await createDoc(vaultId, {
      slug: "late-linker",
      text: "still points at [[was-here]]",
    });
    if ("error" in source) throw new Error(source.error);
    const edges = await edgesFrom(source.id);
    expect(edges[0]!.targetDocId).toBe(target.id);
  });

  it("lets a new doc claim a redirected slug (live doc wins)", async () => {
    const original = await createDoc(vaultId, { slug: "contested" });
    if ("error" in original) throw new Error(original.error);
    await renameDoc(asDoc(original), "contested-moved");

    const claimant = await createDoc(vaultId, { slug: "contested" });
    if ("error" in claimant) throw new Error(claimant.error);

    const resolved = await resolveSlug(vaultId, "contested");
    expect(resolved!.doc.id).toBe(claimant.id);
    expect(resolved!.redirected).toBe(false);
  });
});

describe("deletion", () => {
  // spec: docs/model/L1-model#link-dangling — incoming edges revert to name
  it("reverts incoming edges to dangling and cascades derived state", async () => {
    const target = await createDoc(vaultId, { slug: "doomed" });
    if ("error" in target) throw new Error(target.error);
    const source = await createDoc(vaultId, { slug: "mourner", text: "misses [[doomed]]" });
    if ("error" in source) throw new Error(source.error);

    await deleteDoc(target.id);

    const edges = await edgesFrom(source.id);
    expect(edges[0]!.targetDocId).toBeNull();
    expect(edges[0]!.targetSlug).toBe("doomed");
    expect(await updateRowCount(target.id)).toBe(0);
  });
});

describe("text writes and re-derivation", () => {
  // spec: docs/model/L1-model#text-is-truth — derived state follows the text
  it("replaces derived indexes wholesale on rewrite", async () => {
    const doc = await createDoc(vaultId, {
      slug: "rewritten",
      text: "---\ntags: [old]\n---\nlink [[alpha-x]]\n\n::old-directive",
    });
    if ("error" in doc) throw new Error(doc.error);

    await writeDocText(asDoc(doc), "---\ntags: [new]\n---\nlink [[beta-y]]\n\n::new-directive");

    const [row] = await db.select().from(schema.docs).where(eq(schema.docs.id, doc.id));
    expect(row!.tags).toEqual(["new"]);
    const edges = await edgesFrom(doc.id);
    expect(edges.map((e) => e.targetSlug)).toEqual(["beta-y"]);
    const usages = await db
      .select()
      .from(schema.componentUsages)
      .where(eq(schema.componentUsages.docId, doc.id));
    expect(usages.map((u) => u.name)).toEqual(["new-directive"]);

    // CRDT state still agrees with the column. spec: docs/platform/L1-platform#yjs-persist
    expect(deriveText(await loadYDoc(doc.id))).toBe(row!.text);
  });
});

describe("update log compaction", () => {
  // spec: docs/platform/L1-platform#yjs-persist — periodically compacted
  it("folds update rows into one without losing state", async () => {
    const doc = await createDoc(vaultId, { slug: "compactee", text: "start" });
    if ("error" in doc) throw new Error(doc.error);

    for (let i = 0; i < 10; i++) {
      await replaceText(doc.id, `revision ${i} with more text`);
    }
    expect(await updateRowCount(doc.id)).toBeGreaterThan(1);

    await compact(doc.id);
    expect(await updateRowCount(doc.id)).toBe(1);
    expect(deriveText(await loadYDoc(doc.id))).toBe("revision 9 with more text");
  });
});
