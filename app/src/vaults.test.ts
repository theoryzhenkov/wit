import { describe, expect, it, beforeAll } from "bun:test";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { db, schema } from "./lib/db";
import { eq } from "drizzle-orm";
import { signUpViaMagicLink } from "./lib/test-auth";

const f = fixtures("vaults");

let cookie: string;

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
  ({ cookie } = await signUpViaMagicLink(app, f.email("owner"), "10.2.0.1"));
});

describe("vault creation", () => {
  // spec: docs/platform/L1-platform#auth-editor
  it("requires a session", async () => {
    const unauthed = await app.request("/api/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.vaultName("nope") }),
    });
    expect(unauthed.status).toBe(401);
    expect((await app.request("/api/vaults")).status).toBe(401);
  });

  // spec: docs/model/L1-model#vault-owner
  it("creates the vault with its creator as owner", async () => {
    const res = await app.request("/api/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: f.vaultName("garden") }),
    });
    expect(res.status).toBe(201);
    const vault = (await res.json()) as { id: string; name: string; role: string };
    expect(vault.name).toBe(f.vaultName("garden"));
    expect(vault.role).toBe("owner");

    const members = await db
      .select()
      .from(schema.vaultMembers)
      .where(eq(schema.vaultMembers.vaultId, vault.id));
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe("owner");
  });

  // spec: docs/model/L1-model#vault-access
  it("lists only the member's vaults", async () => {
    const mine = await app.request("/api/vaults", { headers: { cookie } });
    expect(mine.status).toBe(200);
    const list = (await mine.json()) as { name: string; role: string }[];
    expect(list.map((v) => v.name)).toContain(f.vaultName("garden"));

    const { cookie: otherCookie } = await signUpViaMagicLink(app, f.email("other"), "10.2.0.2");
    const theirs = await app.request("/api/vaults", { headers: { cookie: otherCookie } });
    const theirList = (await theirs.json()) as { name: string }[];
    expect(theirList.map((v) => v.name)).not.toContain(f.vaultName("garden"));
  });

  it("rejects empty and oversized names", async () => {
    const post = (name: string) =>
      app.request("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ name }),
      });
    expect((await post("")).status).toBe(400);
    expect((await post("x".repeat(201))).status).toBe(400);
  });
});
