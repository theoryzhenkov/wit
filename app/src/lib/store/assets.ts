import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { emitChange } from "../bus";
import { db, schema } from "../db";

// Disk-backed object storage, addressed by vault + path.
// spec: docs/model/L1-model#asset-coords

/** Upload ceiling. spec: docs/platform/L1-platform#input-caps */
export const MAX_UPLOAD_BYTES = 10_000_000;

function assetRoot(): string {
  return process.env.ASSET_DIR ?? "./data/assets";
}

export type AssetError = "bad-path" | "too-large" | "not-found";

/** Paths are relative, slash-separated, dot-safe segments — traversal is
 *  unrepresentable past this point. */
export function normalizeAssetPath(input: string): string | null {
  const segments = input.split("/").filter((s) => s.length > 0);
  if (segments.length === 0 || segments.length > 20) return null;
  for (const s of segments) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s) || s.includes("..")) return null;
  }
  const path = segments.join("/");
  return path.length <= 512 ? path : null;
}

function diskPath(vaultId: string, path: string): string {
  return join(assetRoot(), vaultId, path);
}

export async function saveAsset(
  vaultId: string,
  rawPath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ id: string; path: string } | { error: AssetError }> {
  const path = normalizeAssetPath(rawPath);
  if (!path) return { error: "bad-path" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: "too-large" };

  const file = diskPath(vaultId, path);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, bytes);

  const [row] = await db
    .insert(schema.assets)
    .values({ vaultId, path, contentType, sizeBytes: bytes.byteLength })
    .onConflictDoUpdate({
      target: [schema.assets.vaultId, schema.assets.path],
      set: { contentType, sizeBytes: bytes.byteLength, updatedAt: new Date() },
    })
    .returning({ id: schema.assets.id, path: schema.assets.path });
  emitChange(vaultId, "assets", [row!.id]);
  return row!;
}

export async function getAsset(vaultId: string, rawPath: string) {
  const path = normalizeAssetPath(rawPath);
  if (!path) return null;
  const [row] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.vaultId, vaultId), eq(schema.assets.path, path)));
  if (!row) return null;
  return { row, file: Bun.file(diskPath(vaultId, path)) };
}

export async function setAssetVisibility(
  vaultId: string,
  rawPath: string,
  visibility: "private" | "unlisted" | "public",
): Promise<boolean> {
  const path = normalizeAssetPath(rawPath);
  if (!path) return false;
  const rows = await db
    .update(schema.assets)
    .set({ visibility, updatedAt: new Date() })
    .where(and(eq(schema.assets.vaultId, vaultId), eq(schema.assets.path, path)))
    .returning({ id: schema.assets.id });
  if (rows.length > 0) emitChange(vaultId, "assets", [rows[0]!.id]);
  return rows.length > 0;
}

export async function deleteAsset(vaultId: string, rawPath: string): Promise<boolean> {
  const path = normalizeAssetPath(rawPath);
  if (!path) return false;
  const rows = await db
    .delete(schema.assets)
    .where(and(eq(schema.assets.vaultId, vaultId), eq(schema.assets.path, path)))
    .returning({ id: schema.assets.id });
  if (rows.length === 0) return false;
  await unlink(diskPath(vaultId, path)).catch(() => {});
  emitChange(vaultId, "assets", [rows[0]!.id]);
  return true;
}
