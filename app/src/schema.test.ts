import { describe, expect, it, beforeAll } from "bun:test";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { db, schema } from "./lib/db";
import { eq } from "drizzle-orm";

// Model invariants the schema itself must hold (the ones a buggy save
// pipeline could otherwise violate).


/** Awaits the query and returns the error text, "" if it succeeded —
 *  drizzle builders are thenables, not Promises, so expect().rejects
 *  cannot await them directly. */
async function errorOf(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
    return "";
  } catch (e) {
    // Drizzle wraps the PG error; the constraint name is in the cause chain.
    let message = "";
    for (let err: unknown = e; err instanceof Error; err = err.cause) {
      message += `${err.message}\n`;
    }
    return message;
  }
}

const f = fixtures("schema");

let vaultId: string;
let otherVaultId: string;

async function makeVault(name: string): Promise<string> {
  const [v] = await db
    .insert(schema.vaults)
    .values({ name: f.vaultName(name) })
    .returning({ id: schema.vaults.id });
  await db
    .insert(schema.vaultMembers)
    .values({ vaultId: v!.id, userId: f.userId("u"), role: "owner" });
  return v!.id;
}

beforeAll(async () => {
  await ensureMigrated();
  await f.reset(["u"]);
  vaultId = await makeVault("main");
  otherVaultId = await makeVault("other");
});

describe("docs", () => {
  // spec: docs/model/L1-model#doc-private-default
  it("are private by default", async () => {
    const [doc] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "fresh-note" })
      .returning();
    expect(doc!.visibility).toBe("private");
  });

  // spec: docs/model/L1-model#slug-unique
  it("reject duplicate slugs within a vault, allow them across vaults", async () => {
    await db.insert(schema.docs).values({ vaultId, slug: "taken" });
    expect(await errorOf(db.insert(schema.docs).values({ vaultId, slug: "taken" }))).toMatch(
      /duplicate key/,
    );
    await db.insert(schema.docs).values({ vaultId: otherVaultId, slug: "taken" });
  });

  // spec: docs/model/L1-model#slug-unique — normalized lowercase kebab
  it("reject un-normalized slugs", async () => {
    for (const bad of ["Upper", "spaced out", "trailing-", "-leading", "dot.sep", ""]) {
      expect(await errorOf(db.insert(schema.docs).values({ vaultId, slug: bad }))).toMatch(
        /docs_slug_kebab/,
      );
    }
  });
});

describe("collection items", () => {
  // spec: docs/model/L1-model#collection-order
  it("require a position on pins and forbid one on excludes", async () => {
    const [col] = await db
      .insert(schema.collections)
      .values({ vaultId, slug: "reading" })
      .returning({ id: schema.collections.id });
    const [doc] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "pinned-note" })
      .returning({ id: schema.docs.id });

    expect(await errorOf(db
        .insert(schema.collectionItems)
        .values({ collectionId: col!.id, docId: doc!.id, kind: "pin", position: null }))).toMatch(/collection_items_pin_position/);
    expect(await errorOf(db
        .insert(schema.collectionItems)
        .values({ collectionId: col!.id, docId: doc!.id, kind: "exclude", position: 0 }))).toMatch(/collection_items_pin_position/);

    await db
      .insert(schema.collectionItems)
      .values({ collectionId: col!.id, docId: doc!.id, kind: "pin", position: 0 });
  });
});

describe("edges", () => {
  // spec: docs/model/L1-model#edge-typed
  it("require a rel on relations and forbid one on wikilinks", async () => {
    const [doc] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "edge-source" })
      .returning({ id: schema.docs.id });
    const base = { vaultId, sourceDocId: doc!.id, targetSlug: "anywhere" };

    expect(await errorOf(db.insert(schema.edges).values({ ...base, kind: "relation", rel: null }))).toMatch(/edges_relation_rel/);
    expect(await errorOf(db.insert(schema.edges).values({ ...base, kind: "wikilink", rel: "up" }))).toMatch(/edges_relation_rel/);

    await db.insert(schema.edges).values({ ...base, kind: "wikilink" });
    await db.insert(schema.edges).values({ ...base, kind: "relation", rel: "up" });
  });

  // spec: docs/model/L1-model#link-dangling — deleting the target reverts
  // the edge to held-by-name, from where it can auto-resolve again.
  it("keep the target slug and drop the UUID when the target doc is deleted", async () => {
    const [source] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "dangling-source" })
      .returning({ id: schema.docs.id });
    const [target] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "dangling-target" })
      .returning({ id: schema.docs.id });
    const [edge] = await db
      .insert(schema.edges)
      .values({
        vaultId,
        sourceDocId: source!.id,
        kind: "wikilink",
        targetSlug: "dangling-target",
        targetDocId: target!.id,
      })
      .returning({ id: schema.edges.id });

    await db.delete(schema.docs).where(eq(schema.docs.id, target!.id));

    const [after] = await db
      .select()
      .from(schema.edges)
      .where(eq(schema.edges.id, edge!.id));
    expect(after!.targetDocId).toBeNull();
    expect(after!.targetSlug).toBe("dangling-target");
  });
});

describe("redirects", () => {
  // spec: docs/model/L1-model#rename-redirect — one resolution per old slug
  it("hold one target per (vault, old slug)", async () => {
    const [doc] = await db
      .insert(schema.docs)
      .values({ vaultId, slug: "renamed-to" })
      .returning({ id: schema.docs.id });
    await db
      .insert(schema.redirects)
      .values({ vaultId, oldSlug: "renamed-from", docId: doc!.id });
    expect(await errorOf(db.insert(schema.redirects).values({ vaultId, oldSlug: "renamed-from", docId: doc!.id }))).toMatch(/duplicate key/);
  });
});

describe("assets", () => {
  // spec: docs/model/L1-model#asset-coords + #asset-visibility
  it("are unique per (vault, path) and private by default", async () => {
    const [asset] = await db
      .insert(schema.assets)
      .values({ vaultId, path: "images/cat.png" })
      .returning();
    expect(asset!.visibility).toBe("private");
    expect(await errorOf(db.insert(schema.assets).values({ vaultId, path: "images/cat.png" }))).toMatch(/duplicate key/);
  });
});
