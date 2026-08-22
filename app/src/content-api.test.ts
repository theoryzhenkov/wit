import { describe, expect, it, beforeAll } from "bun:test";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { signUpViaMagicLink } from "./lib/test-auth";
import { createDoc, setVisibility, type DocRow } from "./lib/store/docs";

// The content API grammar: seven nouns, key scopes, visibility fences,
// ETags, indexed-only operators (P2 exit criteria).

const f = fixtures("content");

let cookie: string;
let vaultId: string;
let readKey: string;
let writeKey: string;
let publicDoc: DocRow;
let privateDoc: DocRow;

function get(path: string, auth?: { key?: string; cookie?: string; etag?: string }) {
  const headers: Record<string, string> = {};
  if (auth?.key) headers["Authorization"] = `Bearer ${auth.key}`;
  if (auth?.cookie) headers["cookie"] = auth.cookie;
  if (auth?.etag) headers["If-None-Match"] = auth.etag;
  return app.request(`/api/content/${vaultId}/${path}`, { headers });
}

async function items(res: Response): Promise<Record<string, unknown>[]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Record<string, unknown>[] }).items;
}

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
  ({ cookie } = await signUpViaMagicLink(app, f.email("owner"), "10.4.0.1"));
  const vaultRes = await app.request("/api/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: f.vaultName("content") }),
  });
  vaultId = ((await vaultRes.json()) as { id: string }).id;

  const mkKey = async (scope: string) => {
    const res = await app.request(`/api/vaults/${vaultId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: `${scope} key`, scope }),
    });
    return ((await res.json()) as { token: string }).token;
  };
  readKey = await mkKey("read");
  writeKey = await mkKey("write");

  const mk = async (slug: string, text: string, visibility?: "public" | "unlisted") => {
    const doc = await createDoc(vaultId, { slug, text });
    if ("error" in doc) throw new Error(doc.error);
    if (visibility) await setVisibility(doc.id, visibility);
    return doc;
  };
  publicDoc = await mk(
    "pub-note",
    "---\ntags: [garden]\n---\n# Public Note\n\nAbout pergolas and [[hidden-note]].",
    "public",
  );
  await mk("half-note", "# Unlisted Note\n\nquiet content", "unlisted");
  privateDoc = await mk(
    "hidden-note",
    "---\ntags: [garden]\n---\n# Private Note\n\nlinks [[pub-note]]\n\n::secret-widget",
  );
  await setVisibility(privateDoc.id, "private");
});

describe("key scopes and visibility", () => {
  // spec: docs/platform/L1-platform#api-key-scope
  // spec: docs/model/L1-model#visibility-tiers
  it("read keys list public docs only", async () => {
    const list = await items(await get("docs", { key: readKey }));
    expect(list.map((d) => d["slug"])).toEqual(["pub-note"]);
  });

  // spec: docs/model/L1-model#visibility-tiers — unlisted = direct fetch only
  it("read keys fetch unlisted docs by slug but never see them in listings or search", async () => {
    const direct = await items(await get("docs?slug=eq.half-note", { key: readKey }));
    expect(direct.map((d) => d["slug"])).toEqual(["half-note"]);
    const search = await items(await get("docs?fts=quiet", { key: readKey }));
    expect(search).toHaveLength(0);
  });

  // spec: docs/model/L1-model#private-never-served
  it("never serves private docs to read keys, even by slug", async () => {
    const direct = await items(await get("docs?slug=eq.hidden-note", { key: readKey }));
    expect(direct).toHaveLength(0);
  });

  it("write keys and members see all visibilities", async () => {
    const viaWrite = await items(await get("docs?order=slug.asc", { key: writeKey }));
    expect(viaWrite.map((d) => d["slug"])).toEqual(["half-note", "hidden-note", "pub-note"]);
    const viaSession = await items(await get("docs?order=slug.asc", { cookie }));
    expect(viaSession).toHaveLength(3);
  });

  it("rejects requests with no principal or a foreign key", async () => {
    expect((await get("docs")).status).toBe(401);
    expect((await get("docs", { key: "wit_read_bogus" })).status).toBe(401);
  });
});

describe("the grammar", () => {
  // spec: docs/platform/L1-platform#grammar-nouns
  it("serves exactly the seven nouns", async () => {
    for (const noun of ["docs", "collections", "membership", "edges", "assets", "components", "usages"]) {
      const res = await get(noun === "membership" ? "membership?collection=eq.none" : noun, {
        key: writeKey,
      });
      expect([200, 400]).toContain(res.status); // membership 400s on unknown collection
    }
    expect((await get("backlinks", { key: writeKey })).status).toBe(404);
    expect((await get("search", { key: writeKey })).status).toBe(404);
  });

  // spec: docs/platform/L1-platform#grammar-indexed
  it("rejects operators no index can serve", async () => {
    expect((await get("docs?slug=contains.note", { key: writeKey })).status).toBe(400);
    expect((await get("docs?nope=eq.x", { key: writeKey })).status).toBe(400);
    expect((await get("docs?slug=like.x", { key: writeKey })).status).toBe(400);
    expect((await get("docs?tags=eq.garden", { key: writeKey })).status).toBe(400);
    expect((await get("edges?slug=prefix.x", { key: writeKey })).status).toBe(400);
  });

  // spec: docs/platform/L1-platform#fts-operator
  it("serves full-text search over title, body, and tags", async () => {
    const byBody = await items(await get("docs?fts=pergolas", { key: writeKey }));
    expect(byBody.map((d) => d["slug"])).toEqual(["pub-note"]);
    const byTitle = await items(await get("docs?fts=private", { key: writeKey }));
    expect(byTitle.map((d) => d["slug"])).toEqual(["hidden-note"]);
    const byTag = await items(await get("docs?fts=garden&order=slug.asc", { key: writeKey }));
    expect(byTag.map((d) => d["slug"])).toEqual(["hidden-note", "pub-note"]);
  });

  it("filters on tags and frontmatter through indexes", async () => {
    const tagged = await items(await get("docs?tags=contains.garden&order=slug.asc", { key: writeKey }));
    expect(tagged).toHaveLength(2);
    const withTags = await items(await get("docs?fm.tags=exists&order=slug.asc", { key: writeKey }));
    expect(withTags).toHaveLength(2);
  });

  // spec: docs/platform/L1-platform#markdown-out
  it("returns raw markdown only on include=body, never HTML", async () => {
    const bare = await items(await get("docs?slug=eq.pub-note", { key: readKey }));
    expect(bare[0]!["text"]).toBeUndefined();
    const full = await items(await get("docs?slug=eq.pub-note&include=body", { key: readKey }));
    expect(full[0]!["text"]).toContain("# Public Note");
    expect(JSON.stringify(full[0])).not.toContain("<h1>");
  });

  // spec: docs/model/L1-model#backlinks-derived
  it("folds backlinks in as an edge read, fenced by source visibility", async () => {
    const asWrite = await items(
      await get("docs?slug=eq.pub-note&include=backlinks", { key: writeKey }),
    );
    expect((asWrite[0]!["backlinks"] as unknown[]).length).toBe(1);
    // The only backlink source is private — invisible to read keys.
    const asRead = await items(
      await get("docs?slug=eq.pub-note&include=backlinks", { key: readKey }),
    );
    expect(asRead[0]!["backlinks"]).toEqual([]);
  });

  it("paginates with cursors", async () => {
    const first = await get("docs?order=slug.asc&limit=2", { key: writeKey });
    const page1 = (await first.json()) as { items: { slug: string }[]; next: string | null };
    expect(page1.items.map((d) => d.slug)).toEqual(["half-note", "hidden-note"]);
    expect(page1.next).not.toBeNull();
    const second = await get(`docs?order=slug.asc&limit=2&cursor=${page1.next}`, {
      key: writeKey,
    });
    const page2 = (await second.json()) as { items: { slug: string }[]; next: string | null };
    expect(page2.items.map((d) => d.slug)).toEqual(["pub-note"]);
    expect(page2.next).toBeNull();
  });
});

describe("etags", () => {
  // spec: docs/platform/L1-platform#grammar-get-etag
  it("returns a strong ETag and 304 on conditional re-request", async () => {
    const res = await get("docs?order=slug.asc", { key: writeKey });
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const conditional = await get("docs?order=slug.asc", { key: writeKey, etag: etag! });
    expect(conditional.status).toBe(304);

    // Content change → new ETag → full 200.
    await setVisibility(publicDoc.id, "public"); // touch updated_at
    const after = await get("docs?order=slug.asc", { key: writeKey, etag: etag! });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
  });
});

describe("edges and usages nouns", () => {
  // spec: docs/model/L1-model#private-never-served — edges of private
  // sources never leave the API for read keys.
  it("fences edge and usage listings by source visibility", async () => {
    const asWrite = await items(await get(`edges?target=eq.${publicDoc.id}`, { key: writeKey }));
    expect(asWrite).toHaveLength(1);
    const asRead = await items(await get(`edges?target=eq.${publicDoc.id}`, { key: readKey }));
    expect(asRead).toHaveLength(0);

    const usagesWrite = await items(await get("usages?name=eq.secret-widget", { key: writeKey }));
    expect(usagesWrite).toHaveLength(1);
    const usagesRead = await items(await get("usages?name=eq.secret-widget", { key: readKey }));
    expect(usagesRead).toHaveLength(0);
  });
});

describe("admin fence", () => {
  // spec: docs/platform/L1-platform#api-key-scope — no admin via keys
  it("keeps key management session-only", async () => {
    const viaKey = await app.request(`/api/vaults/${vaultId}/keys`, {
      headers: { Authorization: `Bearer ${writeKey}` },
    });
    expect(viaKey.status).toBe(401);
  });
});
