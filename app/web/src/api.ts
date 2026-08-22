// Thin typed client over wit's management routes and content grammar.
// Session-cookie auth throughout — this is the editor surface.

export interface SessionUser {
  id: string;
  email: string;
}

export interface Vault {
  id: string;
  name: string;
  role: string;
}

export interface DocSummary {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  visibility: "private" | "unlisted" | "public";
  updatedAt: string;
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  rule: { filters: { on: string; op: string; value?: unknown }[] } | null;
  sortKey: string | null;
}

export interface MemberEntry {
  docId: string;
  slug: string;
  title: string;
  visibility: string;
  kind: "pin" | "rule";
  position: number | null;
}

export interface PropSpec {
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  options?: string[];
}

export interface Manifest {
  name: string;
  description: string;
  props: Record<string, PropSpec>;
  slots: unknown;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status}`);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { "Content-Type": "application/json" };

export const api = {
  async session(): Promise<SessionUser | null> {
    const res = await fetch("/api/auth/get-session");
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser } | null;
    return data?.user ?? null;
  },

  async requestMagicLink(email: string): Promise<void> {
    await json(
      await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email, callbackURL: "/" }),
      }),
    );
  },

  async signOut(): Promise<void> {
    await fetch("/api/auth/sign-out", { method: "POST", headers: jsonHeaders, body: "{}" });
  },

  vaults: {
    list: async () => json<Vault[]>(await fetch("/api/vaults")),
    create: async (name: string) =>
      json<Vault>(
        await fetch("/api/vaults", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ name }),
        }),
      ),
  },

  docs: {
    list: async (vaultId: string) =>
      json<DocSummary[]>(await fetch(`/api/vaults/${vaultId}/docs`)),
    search: async (vaultId: string, query: string) => {
      const params = new URLSearchParams({ fts: query, limit: "25" });
      const res = await fetch(`/api/content/${vaultId}/docs?${params}`);
      return (await json<{ items: DocSummary[] }>(res)).items;
    },
    create: async (vaultId: string, input: { title?: string; slug?: string; text?: string }) =>
      json<DocSummary & { id: string }>(
        await fetch(`/api/vaults/${vaultId}/docs`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(input),
        }),
      ),
    get: async (vaultId: string, docId: string) =>
      json<DocSummary & { text: string }>(await fetch(`/api/vaults/${vaultId}/docs/${docId}`)),
    patch: async (
      vaultId: string,
      docId: string,
      input: { slug?: string; visibility?: string },
    ) =>
      json<DocSummary>(
        await fetch(`/api/vaults/${vaultId}/docs/${docId}`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify(input),
        }),
      ),
    remove: async (vaultId: string, docId: string) =>
      json(await fetch(`/api/vaults/${vaultId}/docs/${docId}`, { method: "DELETE" })),
  },

  collections: {
    list: async (vaultId: string) => {
      const res = await fetch(`/api/content/${vaultId}/collections?limit=100`);
      return (await json<{ items: Collection[] }>(res)).items;
    },
    membership: async (vaultId: string, slug: string) => {
      const params = new URLSearchParams({ collection: `eq.${slug}`, limit: "100" });
      const res = await fetch(`/api/content/${vaultId}/membership?${params}`);
      return (await json<{ items: MemberEntry[] }>(res)).items;
    },
    create: async (
      vaultId: string,
      input: { slug: string; name?: string; rule?: unknown; sortKey?: string },
    ) =>
      json<{ id: string; slug: string }>(
        await fetch(`/api/vaults/${vaultId}/collections`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(input),
        }),
      ),
    update: async (
      vaultId: string,
      collectionId: string,
      input: { name?: string; rule?: unknown; sortKey?: string },
    ) =>
      json(
        await fetch(`/api/vaults/${vaultId}/collections/${collectionId}`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify(input),
        }),
      ),
    remove: async (vaultId: string, collectionId: string) =>
      json(
        await fetch(`/api/vaults/${vaultId}/collections/${collectionId}`, { method: "DELETE" }),
      ),
    setItem: async (
      vaultId: string,
      collectionId: string,
      docId: string,
      kind: "pin" | "exclude",
      position?: number,
    ) =>
      json(
        await fetch(`/api/vaults/${vaultId}/collections/${collectionId}/items/${docId}`, {
          method: "PUT",
          headers: jsonHeaders,
          body: JSON.stringify({ kind, position }),
        }),
      ),
    removeItem: async (vaultId: string, collectionId: string, docId: string) =>
      json(
        await fetch(`/api/vaults/${vaultId}/collections/${collectionId}/items/${docId}`, {
          method: "DELETE",
        }),
      ),
  },

  keys: {
    list: async (vaultId: string) =>
      json<{ id: string; name: string; scope: string; createdAt: string; lastUsedAt: string | null }[]>(
        await fetch(`/api/vaults/${vaultId}/keys`),
      ),
    create: async (vaultId: string, name: string, scope: "read" | "write") =>
      json<{ id: string; token: string }>(
        await fetch(`/api/vaults/${vaultId}/keys`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ name, scope }),
        }),
      ),
    remove: async (vaultId: string, keyId: string) =>
      json(await fetch(`/api/vaults/${vaultId}/keys/${keyId}`, { method: "DELETE" })),
  },

  edges: {
    backlinks: async (vaultId: string, docId: string) => {
      const params = new URLSearchParams({ target: `eq.${docId}`, limit: "100" });
      const res = await fetch(`/api/content/${vaultId}/edges?${params}`);
      return (
        await json<{ items: { source: string; kind: string; rel: string | null }[] }>(res)
      ).items;
    },
  },

  components: {
    // The UI reads the registry, never writes it.
    // spec: docs/model/L1-model#registry-manifests
    list: async (vaultId: string) => {
      const res = await fetch(`/api/content/${vaultId}/components?limit=100`);
      return (await json<{ items: Manifest[] }>(res)).items;
    },
  },

  assets: {
    upload: async (vaultId: string, path: string, file: File) =>
      json<{ path: string }>(
        await fetch(`/api/vaults/${vaultId}/assets/${path}`, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        }),
      ),
  },
};
