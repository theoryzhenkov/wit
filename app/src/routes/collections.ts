import { Hono } from "hono";
import {
  createCollection,
  deleteCollection,
  removeItem,
  setItem,
  updateCollection,
} from "../lib/store/collections";
import { requireMembership, requireSession, type GuardEnv } from "./guard";

// Collection management (create, rules, pins, order) for the editor.
// Reading membership happens through the content API's membership noun.

export const collections = new Hono<GuardEnv>();

collections.use("*", requireSession, requireMembership);

collections.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.slug !== "string" || !body.slug) {
    return c.json({ error: "slug required" }, 400);
  }
  const result = await createCollection(c.get("membership").vaultId, {
    slug: body.slug,
    name: typeof body.name === "string" ? body.name : undefined,
    rule: "rule" in body ? body.rule : undefined,
    sortKey: typeof body.sortKey === "string" ? body.sortKey : undefined,
  });
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "slug-taken" ? 409 : 400);
  }
  return c.json(result, 201);
});

collections.patch("/:collectionId", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid body" }, 400);
  const result = await updateCollection(c.get("membership").vaultId, c.req.param("collectionId"), {
    name: typeof body.name === "string" ? body.name : undefined,
    rule: "rule" in body ? body.rule : undefined,
    sortKey: typeof body.sortKey === "string" ? body.sortKey : undefined,
  });
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "not-found" ? 404 : 400);
  }
  return c.json(result);
});

collections.delete("/:collectionId", async (c) => {
  const gone = await deleteCollection(c.get("membership").vaultId, c.req.param("collectionId"));
  if (!gone) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Pins and excludes. spec: docs/model/L1-model#collection-order
collections.put("/:collectionId/items/:docId", async (c) => {
  const body = await c.req.json().catch(() => null);
  const kind = body?.kind;
  if (kind !== "pin" && kind !== "exclude") {
    return c.json({ error: "kind must be pin or exclude" }, 400);
  }
  const result = await setItem(
    c.get("membership").vaultId,
    c.req.param("collectionId"),
    c.req.param("docId"),
    kind,
    typeof body?.position === "number" ? body.position : undefined,
  );
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "not-found" ? 404 : 400);
  }
  return c.json(result);
});

collections.delete("/:collectionId/items/:docId", async (c) => {
  const gone = await removeItem(
    c.get("membership").vaultId,
    c.req.param("collectionId"),
    c.req.param("docId"),
  );
  if (!gone) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
