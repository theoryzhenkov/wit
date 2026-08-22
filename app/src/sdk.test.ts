import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { createClient, type Change } from "@wit/client";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { signUpViaMagicLink } from "./lib/test-auth";
import { createDoc, setVisibility, writeDocText, type DocRow } from "./lib/store/docs";
import { createCollection, setItem } from "./lib/store/collections";
import { startServer } from "./server";

// @wit/client against the real server: every helper is a composition of
// grammar calls — this suite is the sdk-client-side proof.
// spec: docs/platform/L1-platform#sdk-client-side

const f = fixtures("sdk");

let server: ReturnType<typeof startServer>;
let cookie: string;
let vaultId: string;
let readKey: string;
let hub: DocRow;
let leaf: DocRow;

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
  ({ cookie } = await signUpViaMagicLink(app, f.email("owner"), "10.6.0.1"));
  const vaultRes = await app.request("/api/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: f.vaultName("sdk") }),
  });
  vaultId = ((await vaultRes.json()) as { id: string }).id;
  const keyRes = await app.request(`/api/vaults/${vaultId}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "site", scope: "read" }),
  });
  readKey = ((await keyRes.json()) as { token: string }).token;

  const mk = async (slug: string, text: string) => {
    const doc = await createDoc(vaultId, { slug, text });
    if ("error" in doc) throw new Error(doc.error);
    await setVisibility(doc.id, "public");
    return doc;
  };
  hub = await mk("garden-hub", "---\ntags: [essay]\n---\n# The Hub\n\nwelcome to the pergola");
  leaf = await mk("garden-leaf", "---\ntags: [essay]\n---\n# A Leaf\n\npoints [[garden-hub]]");

  const col = await createCollection(vaultId, {
    slug: "essays",
    rule: { filters: [{ on: "tags", op: "contains", value: "essay" }] },
    sortKey: "slug.asc",
  });
  if ("error" in col) throw new Error(col.error);
  await setItem(vaultId, col.id, leaf.id, "pin", 0);

  server = startServer(0);
});

afterAll(() => {
  server?.stop(true);
});

function client() {
  return createClient({
    baseUrl: `http://localhost:${server.port}`,
    vaultId,
    key: readKey,
  });
}

describe("@wit/client", () => {
  it("fetches a doc with raw markdown body", async () => {
    const doc = await client().doc("garden-hub");
    expect(doc?.title).toBe("The Hub");
    expect(doc?.text).toContain("welcome to the pergola");
  });

  it("searches through the fts operator", async () => {
    const hits = await client().search("pergola");
    expect(hits.map((d) => d.slug)).toEqual(["garden-hub"]);
  });

  // spec: docs/model/L1-model#backlinks-derived
  it("assembles backlinks from the edges noun", async () => {
    const links = await client().backlinks(hub.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe(leaf.id);
  });

  it("assembles the graph from two listings", async () => {
    const { nodes, links } = await client().graph();
    expect(nodes.map((n) => n.slug).sort()).toEqual(["garden-hub", "garden-leaf"]);
    expect(links.some((l) => l.source === leaf.id && l.target === hub.id)).toBe(true);
  });

  // spec: docs/model/L1-model#collection-algebra
  it("reads effective collection membership in algebra order", async () => {
    const members = await client().members("essays");
    expect(members.map((m) => m.slug)).toEqual(["garden-leaf", "garden-hub"]);
    expect(members[0]!.kind).toBe("pin");
  });

  // Export is a grammar composition, not a feature.
  it("exports every visible doc as raw markdown", async () => {
    const exported = await client().export();
    expect(exported).toHaveLength(2);
    expect(exported.find((d) => d.slug === "garden-leaf")!.text).toContain("[[garden-hub]]");
  });

  // spec: docs/platform/L1-platform#grammar-get-etag
  it("serves repeat queries from the conditional-GET cache", async () => {
    let statuses: number[] = [];
    const c = createClient({
      baseUrl: `http://localhost:${server.port}`,
      vaultId,
      key: readKey,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const res = await fetch(input, init);
        statuses.push(res.status);
        return res;
      }) as typeof fetch,
    });
    await c.docs({ order: "slug.asc" });
    await c.docs({ order: "slug.asc" });
    expect(statuses).toEqual([200, 304]);
  });

  // spec: docs/platform/L1-platform#sse-feed
  it("receives change events and drops its cache", async () => {
    const c = client();
    const changes: Change[] = [];
    const stop = c.subscribe((change) => changes.push(change));
    await new Promise((r) => setTimeout(r, 150));
    await writeDocText(hub, "# The Hub\n\nrepainted");
    const deadline = Date.now() + 3000;
    while (changes.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    stop();
    expect(changes.some((ch) => ch.noun === "docs" && ch.ids.includes(hub.id))).toBe(true);
  });
});
