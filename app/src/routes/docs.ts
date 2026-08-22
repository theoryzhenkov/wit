import { Hono } from "hono";
import {
  createDoc,
  deleteDoc,
  getDoc,
  listDocs,
  renameDoc,
  setVisibility,
  writeDocText,
  MAX_DOC_BYTES,
} from "../lib/store/docs";
import { requireMembership, requireSession, type GuardEnv } from "./guard";

// Doc management for the editor and the API door. Mounted at
// /api/vaults/:vaultId/docs — everything here is membership-guarded.

const VISIBILITIES = new Set(["private", "unlisted", "public"]);

export const docs = new Hono<GuardEnv>();

docs.use("*", requireSession, requireMembership);

docs.get("/", async (c) => {
  return c.json(await listDocs(c.get("membership").vaultId));
});

docs.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = {
    slug: typeof body?.slug === "string" ? body.slug : undefined,
    title: typeof body?.title === "string" ? body.title : undefined,
    text: typeof body?.text === "string" ? body.text : undefined,
  };
  const result = await createDoc(c.get("membership").vaultId, input);
  if ("error" in result) {
    const status = result.error === "doc-too-large" ? 413 : 409;
    return c.json({ error: result.error, maxBytes: MAX_DOC_BYTES }, status);
  }
  const created = await getDoc(result.vaultId, result.id);
  return c.json(created, 201);
});

docs.get("/:docId", async (c) => {
  const doc = await getDoc(c.get("membership").vaultId, c.req.param("docId"));
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});

docs.patch("/:docId", async (c) => {
  const vaultId = c.get("membership").vaultId;
  const doc = await getDoc(vaultId, c.req.param("docId"));
  if (!doc) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid body" }, 400);

  if (typeof body.text === "string") {
    const written = await writeDocText(doc, body.text);
    if ("error" in written) {
      return c.json({ error: written.error, maxBytes: MAX_DOC_BYTES }, 413);
    }
  }
  if (typeof body.slug === "string") {
    const renamed = await renameDoc(doc, body.slug);
    if ("error" in renamed) return c.json({ error: renamed.error }, 409);
  }
  if (typeof body.visibility === "string") {
    if (!VISIBILITIES.has(body.visibility)) return c.json({ error: "invalid visibility" }, 400);
    await setVisibility(doc.id, body.visibility as "private" | "unlisted" | "public");
  }
  return c.json(await getDoc(vaultId, doc.id));
});

docs.delete("/:docId", async (c) => {
  const doc = await getDoc(c.get("membership").vaultId, c.req.param("docId"));
  if (!doc) return c.json({ error: "not found" }, 404);
  await deleteDoc(doc.id);
  return c.json({ ok: true });
});
