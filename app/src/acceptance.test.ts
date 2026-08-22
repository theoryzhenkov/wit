import { describe, expect, it, beforeAll } from "bun:test";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { signUpViaMagicLink } from "./lib/test-auth";

// The v1 stranger path, end to end through the HTTP surface only: sign
// up, create a vault, publish a public doc, read it back with your own
// key. spec: docs/product/L1-product#accept-stranger

const f = fixtures("stranger");

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
});

describe("a stranger", () => {
  it("signs up, creates a vault, publishes, and reads via their own key", async () => {
    // Open signup: nobody invited this address.
    // spec: docs/model/L1-model#signup-open
    const { cookie } = await signUpViaMagicLink(app, f.email("newcomer"), "10.7.0.1");

    const vaultRes = await app.request("/api/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: f.vaultName("first-garden") }),
    });
    expect(vaultRes.status).toBe(201);
    const vault = (await vaultRes.json()) as { id: string; role: string };
    expect(vault.role).toBe("owner"); // spec: docs/model/L1-model#vault-owner

    const docRes = await app.request(`/api/vaults/${vault.id}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        slug: "hello-world",
        text: "# Hello\n\nMy first public note.",
      }),
    });
    expect(docRes.status).toBe(201);
    const doc = (await docRes.json()) as { id: string; visibility: string };
    expect(doc.visibility).toBe("private"); // spec: docs/model/L1-model#doc-private-default

    const publish = await app.request(`/api/vaults/${vault.id}/docs/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(publish.status).toBe(200);

    const keyRes = await app.request(`/api/vaults/${vault.id}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "my site", scope: "read" }),
    });
    expect(keyRes.status).toBe(201);
    const { token } = (await keyRes.json()) as { token: string };

    // Their own key, the content API, raw markdown out.
    const read = await app.request(
      `/api/content/${vault.id}/docs?slug=eq.hello-world&include=body`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(read.status).toBe(200);
    const { items } = (await read.json()) as { items: { title: string; text: string }[] };
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Hello");
    expect(items[0]!.text).toContain("My first public note.");
  });
});
