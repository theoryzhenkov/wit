import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { fixtures, ensureMigrated } from "./lib/test-db";
import { app } from "./app";
import { signUpViaMagicLink } from "./lib/test-auth";
import { db, schema } from "./lib/db";
import { eq } from "drizzle-orm";
import { startServer } from "./server";
import { roomCount } from "./lib/yjs/relay";
import { TEXT_KEY } from "./lib/yjs/store";

// The relay proper: two real websocket clients on one doc, synced through
// the Bun process, with persistence and the debounced save behind them.
// spec: docs/platform/L1-platform#one-process / #yjs-persist

const f = fixtures("relay");

const MESSAGE_SYNC = 0;

let server: ReturnType<typeof startServer>;
let cookie: string;
let vaultId: string;
let docId: string;

/** Minimal y-websocket client: step1 handshake + update exchange. */
function connectClient(ydoc: Y.Doc, withCookie: string) {
  const url = `ws://localhost:${server.port}/api/vaults/${vaultId}/docs/${docId}/ws`;
  const ws = new WebSocket(url, { headers: { cookie: withCookie } } as never);
  ws.binaryType = "arraybuffer";

  let resolveSynced: () => void;
  const synced = new Promise<void>((r) => {
    resolveSynced = r;
  });

  ws.onopen = () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    ws.send(encoding.toUint8Array(encoder));
  };
  ws.onmessage = (event) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const type = syncProtocol.readSyncMessage(decoder, encoder, ydoc, "remote");
    if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
    if (type === syncProtocol.messageYjsSyncStep2) resolveSynced();
  };
  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote" || ws.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(encoding.toUint8Array(encoder));
  });

  return { ws, synced };
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  await ensureMigrated();
  await f.reset();
  ({ cookie } = await signUpViaMagicLink(app, f.email("editor"), "10.3.0.1"));

  const vaultRes = await app.request("/api/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: f.vaultName("relay") }),
  });
  vaultId = ((await vaultRes.json()) as { id: string }).id;

  const docRes = await app.request(`/api/vaults/${vaultId}/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ slug: "collab", text: "hello" }),
  });
  docId = ((await docRes.json()) as { id: string }).id;

  server = startServer(0);
});

afterAll(() => {
  server?.stop(true);
});

describe("yjs relay", () => {
  // spec: docs/model/L1-model#vault-access — no session, no socket
  it("rejects unauthenticated upgrades", async () => {
    const res = await fetch(`http://localhost:${server.port}/api/vaults/${vaultId}/docs/${docId}/ws`, {
      headers: { Upgrade: "websocket", Connection: "Upgrade" },
    });
    expect(res.status).toBe(401);
  });

  it("syncs edits between two clients and persists derived text", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = connectClient(docA, cookie);
    const b = connectClient(docB, cookie);
    await a.synced;
    await b.synced;

    // Both clients see the seeded text.
    expect(docA.getText(TEXT_KEY).toString()).toBe("hello");
    expect(docB.getText(TEXT_KEY).toString()).toBe("hello");

    // A types; B receives through the relay.
    docA.getText(TEXT_KEY).insert(5, " world [[relay-friend]]");
    await until(() => docB.getText(TEXT_KEY).toString().includes("relay-friend"));

    // Idle save derives text + indexes from CRDT state.
    // spec: docs/platform/L1-platform#yjs-persist
    await new Promise((r) => setTimeout(r, 700));
    const [row] = await db.select().from(schema.docs).where(eq(schema.docs.id, docId));
    expect(row!.text).toBe("hello world [[relay-friend]]");
    const edges = await db
      .select()
      .from(schema.edges)
      .where(eq(schema.edges.sourceDocId, docId));
    expect(edges.map((e) => e.targetSlug)).toEqual(["relay-friend"]);

    a.ws.close();
    b.ws.close();
    await until(() => roomCount() === 0);
  });

  it("serves persisted state to a late joiner", async () => {
    const late = new Y.Doc();
    const c = connectClient(late, cookie);
    await c.synced;
    expect(late.getText(TEXT_KEY).toString()).toBe("hello world [[relay-friend]]");
    c.ws.close();
    await until(() => roomCount() === 0);
  });
});
