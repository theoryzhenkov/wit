import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { signUpViaMagicLink } from "./lib/test-auth";
import { createDoc, setVisibility, writeDocText, type DocRow } from "./lib/store/docs";
import { startServer } from "./server";

// Collections algebra, registry reconciliation, assets, and the SSE
// feed — the rest of the P2 exit criteria.

const f = fixtures("colreg");

let cookie: string;
let vaultId: string;
let writeKey: string;
let readKey: string;

function req(path: string, init: RequestInit & { key?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (init.key) headers["Authorization"] = `Bearer ${init.key}`;
  else headers["cookie"] = cookie;
  return app.request(path, { ...init, headers });
}

beforeAll(async () => {
  process.env.ASSET_DIR = mkdtempSync(join(tmpdir(), "wit-assets-"));
  await ensureMigrated();
  await f.reset();
  ({ cookie } = await signUpViaMagicLink(app, f.email("owner"), "10.5.0.1"));
  const vaultRes = await req("/api/vaults", {
    method: "POST",
    body: JSON.stringify({ name: f.vaultName("main") }),
  });
  vaultId = ((await vaultRes.json()) as { id: string }).id;
  for (const scope of ["read", "write"] as const) {
    const res = await req(`/api/vaults/${vaultId}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: scope, scope }),
    });
    const token = ((await res.json()) as { token: string }).token;
    if (scope === "read") readKey = token;
    else writeKey = token;
  }
});

describe("collection algebra", () => {
  let essays: { id: string };
  const docsBySlug = new Map<string, DocRow>();

  const mkDoc = async (slug: string, tags: string[], visibility: "public" | "private") => {
    const doc = await createDoc(vaultId, {
      slug,
      text: `---\ntags: [${tags.join(", ")}]\n---\n# ${slug}`,
    });
    if ("error" in doc) throw new Error(doc.error);
    if (visibility === "public") await setVisibility(doc.id, "public");
    docsBySlug.set(slug, doc);
    return doc;
  };

  beforeAll(async () => {
    await mkDoc("essay-a", ["essay"], "public");
    await mkDoc("essay-b", ["essay"], "public");
    await mkDoc("essay-hidden", ["essay"], "private");
    await mkDoc("essay-banned", ["essay"], "public");
    await mkDoc("misc-note", ["misc"], "public");

    const res = await req(`/api/vaults/${vaultId}/collections`, {
      method: "POST",
      body: JSON.stringify({
        slug: "essays",
        name: "Essays",
        rule: { filters: [{ on: "tags", op: "contains", value: "essay" }] },
        sortKey: "slug.asc",
      }),
    });
    expect(res.status).toBe(201);
    essays = (await res.json()) as { id: string };

    // Pin misc-note (outside the rule) at position 0; exclude essay-banned.
    const pin = await req(`/api/vaults/${vaultId}/collections/${essays.id}/items/${docsBySlug.get("misc-note")!.id}`, {
      method: "PUT",
      body: JSON.stringify({ kind: "pin", position: 0 }),
    });
    expect(pin.status).toBe(200);
    const exclude = await req(`/api/vaults/${vaultId}/collections/${essays.id}/items/${docsBySlug.get("essay-banned")!.id}`, {
      method: "PUT",
      body: JSON.stringify({ kind: "exclude" }),
    });
    expect(exclude.status).toBe(200);
  });

  // spec: docs/model/L1-model#collection-algebra + #collection-order
  it("computes rule ∪ pins − excludes, pins first in explicit order", async () => {
    const res = await req(`/api/content/${vaultId}/membership?collection=eq.essays`, {
      key: writeKey,
    });
    const { items } = (await res.json()) as { items: { slug: string; kind: string }[] };
    expect(items.map((m) => m.slug)).toEqual([
      "misc-note", // pin, position 0
      "essay-a", // rule matches, slug.asc
      "essay-b",
      "essay-hidden",
    ]);
    expect(items[0]!.kind).toBe("pin");
    expect(items[1]!.kind).toBe("rule");
  });

  // spec: docs/model/L1-model#visibility-tiers — listings are public-only
  it("hides non-public members from read keys", async () => {
    const res = await req(`/api/content/${vaultId}/membership?collection=eq.essays`, {
      key: readKey,
    });
    const { items } = (await res.json()) as { items: { slug: string }[] };
    expect(items.map((m) => m.slug)).toEqual(["misc-note", "essay-a", "essay-b"]);
  });

  // spec: docs/model/L1-model#collection-many
  it("lets one doc belong to many collections", async () => {
    const second = await req(`/api/vaults/${vaultId}/collections`, {
      method: "POST",
      body: JSON.stringify({
        slug: "everything-essay",
        rule: { filters: [{ on: "tags", op: "contains", value: "essay" }] },
        sortKey: "slug.asc",
      }),
    });
    expect(second.status).toBe(201);
    const res = await req(`/api/content/${vaultId}/membership?collection=eq.everything-essay`, {
      key: writeKey,
    });
    const { items } = (await res.json()) as { items: { slug: string }[] };
    expect(items.map((m) => m.slug)).toContain("essay-a");
  });

  it("rejects unindexable rules at write time", async () => {
    const res = await req(`/api/vaults/${vaultId}/collections`, {
      method: "POST",
      body: JSON.stringify({
        slug: "bad-rule",
        rule: { filters: [{ on: "text", op: "regex", value: ".*" }] },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("registry", () => {
  // spec: docs/platform/L1-platform#api-key-scope — write keys push
  it("accepts pushes from write keys and rejects read keys", async () => {
    const manifests = [
      { name: "hero", description: "A hero image", props: { src: { type: "string", required: true } } },
      { name: "callout", props: { tone: { type: "string" } } },
    ];
    const asRead = await req(`/api/vaults/${vaultId}/registry`, {
      method: "PUT",
      key: readKey,
      body: JSON.stringify(manifests),
    });
    expect(asRead.status).toBe(403);

    const asWrite = await req(`/api/vaults/${vaultId}/registry`, {
      method: "PUT",
      key: writeKey,
      body: JSON.stringify(manifests),
    });
    expect(asWrite.status).toBe(200);
    const result = (await asWrite.json()) as { added: string[] };
    expect(result.added.sort()).toEqual(["callout", "hero"]);

    // The registry is readable through the components noun.
    // spec: docs/model/L1-model#registry-manifests
    const nounRes = await req(`/api/content/${vaultId}/components`, { key: readKey });
    const { items } = (await nounRes.json()) as { items: { name: string }[] };
    expect(items.map((m) => m.name)).toEqual(["callout", "hero"]);
  });

  // spec: docs/platform/L1-platform#sync-reconcile + #sync-drift-warn
  it("reconciles: updates props, prunes unmapped, warns on used components", async () => {
    const used = await createDoc(vaultId, {
      slug: "uses-hero",
      text: "::hero{src=\"/x.png\"}",
    });
    if ("error" in used) throw new Error(used.error);

    const push = await req(`/api/vaults/${vaultId}/registry`, {
      method: "PUT",
      key: writeKey,
      body: JSON.stringify([
        { name: "hero", props: { src: { type: "string" }, alt: { type: "string" } } },
      ]),
    });
    const result = (await push.json()) as {
      updated: string[];
      pruned: string[];
      warnings: { name: string; reason: string; docSlugs: string[] }[];
    };
    expect(result.updated).toEqual(["hero"]);
    expect(result.pruned).toEqual(["callout"]);
    const heroWarning = result.warnings.find((w) => w.name === "hero");
    expect(heroWarning?.reason).toBe("props-changed");
    expect(heroWarning?.docSlugs).toEqual(["uses-hero"]);
  });
});

describe("assets", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  // spec: docs/model/L1-model#asset-coords + #asset-visibility
  it("uploads by vault+path and fences serving by visibility", async () => {
    const put = await req(`/api/vaults/${vaultId}/assets/images/cat.png`, {
      method: "PUT",
      key: writeKey,
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    expect(put.status).toBe(201);

    // Private by default: read keys never see it.
    // spec: docs/model/L1-model#private-never-served
    const rawPrivate = await req(`/api/content/${vaultId}/assets/raw/images/cat.png`, {
      key: readKey,
    });
    expect(rawPrivate.status).toBe(404);

    const publish = await req(`/api/vaults/${vaultId}/assets/images/cat.png`, {
      method: "PATCH",
      key: writeKey,
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(publish.status).toBe(200);

    const raw = await req(`/api/content/${vaultId}/assets/raw/images/cat.png`, { key: readKey });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(png);

    const listing = await req(`/api/content/${vaultId}/assets`, { key: readKey });
    const { items } = (await listing.json()) as { items: { path: string }[] };
    expect(items.map((a) => a.path)).toEqual(["images/cat.png"]);
  });

  it("rejects traversal-shaped paths", async () => {
    const put = await req(`/api/vaults/${vaultId}/assets/..%2Fescape.png`, {
      method: "PUT",
      key: writeKey,
      body: png,
    });
    expect(put.status).toBe(400);
  });
});

describe("sse feed", () => {
  let server: ReturnType<typeof startServer>;

  beforeAll(() => {
    server = startServer(0);
  });
  afterAll(() => {
    server?.stop(true);
  });

  // spec: docs/platform/L1-platform#sse-feed + #sse-latency
  it("emits (noun, ids, ts) within a second of a save", async () => {
    const doc = await createDoc(vaultId, { slug: "sse-doc", text: "before" });
    if ("error" in doc) throw new Error(doc.error);
    // The feed is fenced for read keys: only public ids are visible.
    // spec: docs/model/L1-model#private-never-served
    await setVisibility(doc.id, "public");

    const controller = new AbortController();
    const res = await fetch(`http://localhost:${server.port}/api/content/${vaultId}/events`, {
      headers: { Authorization: `Bearer ${readKey}` },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Fencing runs per-event async, so noun order isn't guaranteed —
    // wait for the docs event specifically.
    const readUntilChange = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
        for (const m of buffer.matchAll(/event: change\ndata: (.+)\n/g)) {
          const change = JSON.parse(m[1]!) as { noun: string; ids: string[]; ts: number };
          if (change.noun === "docs") return change;
        }
      }
    })();

    // Let the subscription land, then save.
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    await writeDocText(doc, "after the save");
    const change = await readUntilChange;
    expect(change.noun).toBe("docs");
    expect(change.ids).toContain(doc.id);
    expect(Date.now() - started).toBeLessThan(1000);
    controller.abort();
  });
});
