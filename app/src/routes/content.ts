import { createHash } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { subscribe } from "../lib/bus";
import {
  GrammarError,
  parseQuery,
  queryAssets,
  queryCollections,
  queryComponents,
  queryDocs,
  queryEdges,
  queryUsages,
  type Principal,
} from "../lib/content/grammar";
import { getAsset } from "../lib/store/assets";
import { effectiveMembership, getCollectionBySlug } from "../lib/store/collections";
import { withPrincipal, type PrincipalEnv } from "./principal";

// The content API: exactly seven nouns through one grammar, every query
// a GET with a strong ETag. No capability endpoints exist.
// spec: docs/platform/L1-platform#grammar-nouns / #grammar-get-etag

type ContentEnv = PrincipalEnv;

/** Strong ETag over the exact response bytes; conditional requests
 *  return 304 unchanged. spec: docs/platform/L1-platform#grammar-get-etag */
function jsonWithEtag(c: Context, payload: unknown): Response {
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

export const content = new Hono<ContentEnv>();

// The param must appear in the middleware pattern for Hono to bind it.
content.use("/:vaultId/*", withPrincipal);

type NounHandler = (principal: Principal, q: ReturnType<typeof parseQuery>) => Promise<unknown>;

const NOUNS: Record<string, NounHandler> = {
  docs: queryDocs,
  collections: queryCollections,
  edges: queryEdges,
  assets: queryAssets,
  components: queryComponents,
  usages: queryUsages,
};

// Membership: the collection algebra behind the same grammar surface.
// spec: docs/model/L1-model#collection-algebra
async function queryMembership(principal: Principal, c: Context): Promise<unknown> {
  const params = new URL(c.req.url).searchParams;
  const collectionParam = params.get("collection");
  const slug = collectionParam?.match(/^eq\.(.+)$/)?.[1];
  if (!slug) throw new GrammarError("membership requires collection=eq.<slug>");
  const collection = await getCollectionBySlug(principal.vaultId, slug);
  if (!collection) throw new GrammarError("no such collection");
  const q = parseQuery(params);
  for (const cond of q.conds) {
    if (cond.field !== "collection") throw new GrammarError(`unknown membership field ${cond.field}`);
  }
  const entries = await effectiveMembership(principal.vaultId, collection, {
    publicOnly: principal.kind === "read",
  });
  // Membership order is algebra-defined (pins, then rule matches), so the
  // cursor is a position offset into that order.
  const offset = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString()) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new GrammarError("bad cursor");
  const page = entries.slice(offset, offset + q.limit);
  const next =
    offset + q.limit < entries.length
      ? Buffer.from(String(offset + q.limit)).toString("base64url")
      : null;
  return { items: page, next };
}

content.get("/:vaultId/membership", async (c) => {
  try {
    return jsonWithEtag(c, await queryMembership(c.get("principal"), c));
  } catch (e) {
    if (e instanceof GrammarError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

// Raw asset bytes — the one non-JSON read, same visibility fence.
// spec: docs/model/L1-model#asset-visibility
content.get("/:vaultId/assets/raw/*", async (c) => {
  const principal = c.get("principal");
  const path = c.req.path.split("/assets/raw/")[1] ?? "";
  const asset = await getAsset(principal.vaultId, decodeURIComponent(path));
  if (!asset) return c.json({ error: "not found" }, 404);
  if (principal.kind === "read" && asset.row.visibility === "private") {
    // spec: docs/model/L1-model#private-never-served
    return c.json({ error: "not found" }, 404);
  }
  if (!(await asset.file.exists())) return c.json({ error: "not found" }, 404);
  return new Response(asset.file, {
    headers: { "Content-Type": asset.row.contentType },
  });
});

// Per-vault SSE change feed: (noun, ids, timestamp) after each save.
// spec: docs/platform/L1-platform#sse-feed
content.get("/:vaultId/events", async (c) => {
  const principal = c.get("principal");
  return streamSSE(c, async (stream) => {
    let alive = true;
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(principal.vaultId, (change) => {
      void stream.writeSSE({ event: "change", data: JSON.stringify(change) });
    });
    stream.onAbort(() => {
      alive = false;
      unsubscribe();
      wake?.();
    });
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ ts: Date.now() }) });
    // Heartbeat with a teardown-aware sleep: an aborted feed leaves no
    // timer behind.
    while (alive) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      if (alive) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  });
});

content.get("/:vaultId/:noun", async (c) => {
  const handler = NOUNS[c.req.param("noun")];
  if (!handler) return c.json({ error: "unknown noun" }, 404);
  try {
    const q = parseQuery(new URL(c.req.url).searchParams);
    return jsonWithEtag(c, await handler(c.get("principal"), q));
  } catch (e) {
    if (e instanceof GrammarError) return c.json({ error: e.message }, 400);
    throw e;
  }
});
