import { Hono } from "hono";
import {
  deleteAsset,
  MAX_UPLOAD_BYTES,
  saveAsset,
  setAssetVisibility,
} from "../lib/store/assets";
import { requireWrite, withPrincipal, type PrincipalEnv } from "./principal";

// Asset writes (upload, visibility, delete): member session or write key.
// Reads go through the content API (assets noun + assets/raw).

const VISIBILITIES = new Set(["private", "unlisted", "public"]);

// slice past the FIRST route marker: split() would truncate any asset
// path that itself contains an /assets/ segment.
function assetPath(reqPath: string): string {
  const marker = "/assets/";
  const at = reqPath.indexOf(marker);
  return at === -1 ? "" : reqPath.slice(at + marker.length);
}

export const assets = new Hono<PrincipalEnv>();

assets.use("*", withPrincipal, requireWrite);

assets.put("/*", async (c) => {
  const path = assetPath(c.req.path);
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES) {
    // spec: docs/platform/L1-platform#input-caps
    return c.json({ error: "too-large", maxBytes: MAX_UPLOAD_BYTES }, 413);
  }
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const result = await saveAsset(
    c.get("principal").vaultId,
    decodeURIComponent(path),
    bytes,
    contentType,
  );
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "too-large" ? 413 : 400);
  }
  return c.json(result, 201);
});

assets.patch("/*", async (c) => {
  const path = assetPath(c.req.path);
  const body = await c.req.json().catch(() => null);
  if (!VISIBILITIES.has(body?.visibility)) return c.json({ error: "invalid visibility" }, 400);
  const ok = await setAssetVisibility(
    c.get("principal").vaultId,
    decodeURIComponent(path),
    body.visibility,
  );
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

assets.delete("/*", async (c) => {
  const path = assetPath(c.req.path);
  const ok = await deleteAsset(c.get("principal").vaultId, decodeURIComponent(path));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
