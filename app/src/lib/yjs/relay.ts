import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { auth } from "../auth";
import { getMembership } from "../../routes/guard";
import { getDoc } from "../store/docs";
import { saveDocFromYDoc } from "../save";
import { appendUpdate, loadDocState, TEXT_KEY } from "./store";

// The Yjs relay: y-protocols sync + awareness over Bun's native
// websockets, in the same process as the REST API.
// spec: docs/platform/L1-platform#one-process
//
// Every client-origin update is persisted to the update log, and a
// debounced save derives text + indexes once typing goes idle.
// spec: docs/platform/L1-platform#yjs-persist

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const SAVE_DEBOUNCE_MS = 300;

export interface RelayData {
  docId: string;
}

type Conn = ServerWebSocket<RelayData>;

interface Room {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<Conn, Set<number>>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** Serializes persistence so update order in the log matches arrival. */
  persisting: Promise<void>;
}

const rooms = new Map<string, Room>();
const loading = new Map<string, Promise<Room>>();

async function getRoom(docId: string): Promise<Room> {
  const existing = rooms.get(docId);
  if (existing) return existing;
  const pending = loading.get(docId);
  if (pending) return pending;

  const load = loadRoom(docId);
  // finally, not success-path cleanup: a failed load must not leave a
  // rejected promise poisoning every future connection to this doc.
  const tracked = load.finally(() => loading.delete(docId));
  loading.set(docId, tracked);
  return tracked;
}

/** Character cap enforced at the CRDT layer: an oversized doc state is
 *  truncated in a transaction that propagates to all clients.
 *  spec: docs/platform/L1-platform#input-caps */
const MAX_DOC_CHARS = 1_000_000;
const CAP_ORIGIN = "size-cap";

async function loadRoom(docId: string): Promise<Room> {
  const ydoc = new Y.Doc();
  const state = await loadDocState(docId);
  if (state) Y.applyUpdate(ydoc, state, "load");
  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.setLocalState(null);
  const room: Room = { ydoc, awareness, conns: new Map(), saveTimer: null, persisting: Promise.resolve() };

  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "load") return;
    const ytext = ydoc.getText(TEXT_KEY);
    if (origin !== CAP_ORIGIN && ytext.length > MAX_DOC_CHARS) {
      ydoc.transact(() => ytext.delete(MAX_DOC_CHARS, ytext.length - MAX_DOC_CHARS), CAP_ORIGIN);
    }
    room.persisting = room.persisting
      .then(() => appendUpdate(docId, update))
      .catch((e) => console.error(`persist failed for doc ${docId}:`, e));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of room.conns.keys()) {
      if (conn !== origin) conn.send(message);
    }
    scheduleSave(docId, room);
  });

  awareness.on(
    "update",
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const changed = [...added, ...updated, ...removed];
      const ids = room.conns.get(origin as Conn);
      if (ids) {
        for (const id of added) ids.add(id);
        for (const id of removed) ids.delete(id);
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns.keys()) {
        if (conn !== origin) conn.send(message);
      }
    },
  );

  rooms.set(docId, room);
  return room;
}

function scheduleSave(docId: string, room: Room): void {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    void room.persisting.then(() =>
      saveDocFromYDoc(docId).catch((e) => console.error(`save failed for doc ${docId}:`, e)),
    );
  }, SAVE_DEBOUNCE_MS);
}

/** Final save + teardown once the last client leaves. */
async function closeRoom(docId: string, room: Room): Promise<void> {
  rooms.delete(docId);
  if (room.saveTimer) clearTimeout(room.saveTimer);
  await room.persisting;
  await saveDocFromYDoc(docId).catch((e) => console.error(`final save failed for ${docId}:`, e));
  room.awareness.destroy();
  room.ydoc.destroy();
}

/** The room, whether live or still loading — messages must never be
 *  dropped just because the first client's load is in flight. */
async function roomFor(docId: string): Promise<Room | undefined> {
  return rooms.get(docId) ?? loading.get(docId);
}

export const relayWebsocket: WebSocketHandler<RelayData> = {
  async open(ws) {
    const room = await getRoom(ws.data.docId);
    if (ws.readyState !== 1) {
      // Closed while the room was loading.
      if (room.conns.size === 0) await closeRoom(ws.data.docId, room);
      return;
    }
    room.conns.set(ws, new Set());

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.ydoc);
    ws.send(encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }
  },

  async message(ws, raw) {
    const room = await roomFor(ws.data.docId);
    if (!room || typeof raw === "string") return;
    const decoder = decoding.createDecoder(new Uint8Array(raw));
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.ydoc, ws);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
        break;
      }
    }
  },

  async close(ws) {
    const room = await roomFor(ws.data.docId);
    if (!room) return;
    const controlled = room.conns.get(ws);
    room.conns.delete(ws);
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], null);
    }
    if (room.conns.size === 0) await closeRoom(ws.data.docId, room);
  },
};

const DOC_WS_RE = /^\/api\/vaults\/([0-9a-f-]{36})\/docs\/([0-9a-f-]{36})\/ws$/;

/** Routes doc websocket upgrades; returns undefined for other paths.
 *  Session + membership checked before upgrade; non-members see the same
 *  404 as the REST surface. spec: docs/model/L1-model#vault-access */
export async function maybeUpgradeDocSocket(
  req: Request,
  server: { upgrade(req: Request, opts: { data: RelayData }): boolean },
): Promise<Response | undefined | null> {
  const match = new URL(req.url).pathname.match(DOC_WS_RE);
  if (!match) return null;
  const [, vaultId, docId] = match;

  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("unauthorized", { status: 401 });
  const membership = await getMembership(session.user.id, vaultId!);
  if (!membership) return new Response("not found", { status: 404 });
  const doc = await getDoc(vaultId!, docId!);
  if (!doc) return new Response("not found", { status: 404 });

  const upgraded = server.upgrade(req, { data: { docId: docId! } satisfies RelayData });
  return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
}

/** Test-only: number of live rooms (leak checks). */
export function roomCount(): number {
  return rooms.size;
}
