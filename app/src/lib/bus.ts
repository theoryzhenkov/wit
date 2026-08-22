// Per-vault change bus feeding the SSE feed. In-process is the whole
// design: one Bun process serves API, relay, and SSE, so a save's commit
// and its fan-out share an address space.
// spec: docs/platform/L1-platform#sse-feed

export type Noun =
  | "docs"
  | "collections"
  | "membership"
  | "edges"
  | "assets"
  | "components"
  | "usages";

export interface Change {
  noun: Noun;
  ids: string[];
  ts: number;
}

type Listener = (change: Change) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(vaultId: string, listener: Listener): () => void {
  let set = listeners.get(vaultId);
  if (!set) {
    set = new Set();
    listeners.set(vaultId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(vaultId);
  };
}

export function emitChange(vaultId: string, noun: Noun, ids: string[]): void {
  const set = listeners.get(vaultId);
  if (!set || ids.length === 0) return;
  const change: Change = { noun, ids, ts: Date.now() };
  for (const listener of set) {
    try {
      listener(change);
    } catch (e) {
      console.error("bus listener failed:", e);
    }
  }
}

/** Test-only: current subscriber count for a vault. */
export function listenerCount(vaultId: string): number {
  return listeners.get(vaultId)?.size ?? 0;
}
