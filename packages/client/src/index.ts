// @wit/client — typed helpers over wit's content grammar. Everything
// here (graph, backlinks, search, export) composes grammar queries
// client-side; there are no capability endpoints to call.
// spec: docs/platform/L1-platform#sdk-client-side

export interface WitClientOptions {
  /** e.g. https://wit.theor.net */
  baseUrl: string;
  vaultId: string;
  /** API key (read for site consumption, write for tooling). Omit to
   *  rely on ambient cookies (editor contexts). */
  key?: string;
  fetch?: typeof fetch;
}

export interface Doc {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  visibility: "private" | "unlisted" | "public";
  createdAt: string;
  updatedAt: string;
  /** Raw markdown, present with include=body. spec: docs/platform/L1-platform#markdown-out */
  text?: string;
  backlinks?: Backlink[];
}

export interface Backlink {
  sourceId: string;
  sourceSlug: string;
  kind: "wikilink" | "relation";
  rel: string | null;
}

export interface Edge {
  id: string;
  source: string;
  kind: "wikilink" | "relation";
  rel: string | null;
  targetSlug: string;
  target: string | null;
  createdAt: string;
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  rule: unknown;
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

export interface Manifest {
  name: string;
  description: string;
  props: Record<string, PropSpec>;
  slots: unknown;
  syncedAt: string;
}

export interface PropSpec {
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  options?: string[];
}

export interface Usage {
  id: string;
  docId: string;
  name: string;
  props: Record<string, string>;
}

export interface Asset {
  id: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  visibility: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface Change {
  noun: string;
  ids: string[];
  ts: number;
}

export interface DocsQuery {
  slug?: { eq?: string; in?: string[]; prefix?: string };
  tag?: string;
  fm?: Record<string, unknown | { exists: true }>;
  fts?: string;
  visibility?: string;
  order?: `${"updated" | "created" | "slug" | "title"}.${"asc" | "desc"}`;
  include?: ("body" | "backlinks")[];
  limit?: number;
  cursor?: string;
}

interface CacheEntry {
  etag: string;
  body: string;
}

export class WitError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class WitClient {
  private readonly fetchImpl: typeof fetch;
  /** Conditional-GET cache: 304s are served from here.
   *  spec: docs/platform/L1-platform#grammar-get-etag */
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly CACHE_MAX = 500;

  constructor(private readonly opts: WitClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private url(noun: string, params: URLSearchParams): string {
    const query = params.toString();
    return `${this.opts.baseUrl}/api/content/${this.opts.vaultId}/${noun}${query ? `?${query}` : ""}`;
  }

  private async get<T>(noun: string, params: URLSearchParams): Promise<T> {
    const url = this.url(noun, params);
    const headers: Record<string, string> = {};
    if (this.opts.key) headers["Authorization"] = `Bearer ${this.opts.key}`;
    const cached = this.cache.get(url);
    if (cached) headers["If-None-Match"] = cached.etag;

    const res = await this.fetchImpl(url, { headers });
    if (res.status === 304 && cached) return JSON.parse(cached.body) as T;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new WitError(res.status, body?.error ?? `wit: ${res.status}`);
    }
    const body = await res.text();
    const etag = res.headers.get("etag");
    if (etag) {
      if (this.cache.size >= WitClient.CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      this.cache.set(url, { etag, body });
    }
    return JSON.parse(body) as T;
  }

  /** Drop cached responses (call on SSE change events). */
  invalidate(): void {
    this.cache.clear();
  }

  // ── docs ────────────────────────────────────────────────────────────

  private docsParams(q: DocsQuery): URLSearchParams {
    const params = new URLSearchParams();
    if (q.slug?.eq) params.set("slug", `eq.${q.slug.eq}`);
    if (q.slug?.in) params.set("slug", `in.${q.slug.in.join(",")}`);
    if (q.slug?.prefix) params.set("slug", `prefix.${q.slug.prefix}`);
    if (q.tag) params.set("tags", `contains.${q.tag}`);
    for (const [key, value] of Object.entries(q.fm ?? {})) {
      if (value && typeof value === "object" && "exists" in value) {
        params.set(`fm.${key}`, "exists");
      } else {
        params.set(`fm.${key}`, `eq.${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    if (q.fts) params.set("fts", q.fts);
    if (q.visibility) params.set("visibility", `eq.${q.visibility}`);
    if (q.order) params.set("order", q.order);
    if (q.include?.length) params.set("include", q.include.join(","));
    if (q.limit) params.set("limit", String(q.limit));
    if (q.cursor) params.set("cursor", q.cursor);
    return params;
  }

  async docs(q: DocsQuery = {}): Promise<Page<Doc>> {
    return this.get<Page<Doc>>("docs", this.docsParams(q));
  }

  /** Auto-paginating fetch of every matching doc. */
  async allDocs(q: DocsQuery = {}): Promise<Doc[]> {
    const out: Doc[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.docs({ ...q, limit: q.limit ?? 100, cursor });
      out.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor);
    return out;
  }

  /** One doc by slug, body included; null when it doesn't exist (or is
   *  not visible to this key). */
  async doc(slug: string, include: ("body" | "backlinks")[] = ["body"]): Promise<Doc | null> {
    const page = await this.docs({ slug: { eq: slug }, include });
    return page.items[0] ?? null;
  }

  /** Full-text search, composed from the fts operator.
   *  spec: docs/platform/L1-platform#fts-operator */
  async search(query: string, limit = 25): Promise<Doc[]> {
    const page = await this.docs({ fts: query, limit });
    return page.items;
  }

  // ── edges, backlinks, graph ─────────────────────────────────────────

  async edges(filter: {
    source?: string;
    target?: string;
    kind?: "wikilink" | "relation";
    rel?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Page<Edge>> {
    const params = new URLSearchParams();
    if (filter.source) params.set("source", `eq.${filter.source}`);
    if (filter.target) params.set("target", `eq.${filter.target}`);
    if (filter.kind) params.set("kind", `eq.${filter.kind}`);
    if (filter.rel) params.set("rel", `eq.${filter.rel}`);
    if (filter.limit) params.set("limit", String(filter.limit));
    if (filter.cursor) params.set("cursor", filter.cursor);
    return this.get<Page<Edge>>("edges", params);
  }

  /** Backlinks are an edge read, assembled here — not an endpoint.
   *  spec: docs/model/L1-model#backlinks-derived */
  async backlinks(docId: string): Promise<Edge[]> {
    const out: Edge[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.edges({ target: docId, limit: 100, cursor });
      out.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor);
    return out;
  }

  /** The whole link graph, assembled client-side from two listings. */
  async graph(): Promise<{ nodes: Doc[]; links: Edge[] }> {
    const nodes = await this.allDocs();
    const links: Edge[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.edges({ limit: 100, cursor });
      links.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor);
    return { nodes, links };
  }

  // ── collections ─────────────────────────────────────────────────────

  async collections(): Promise<Collection[]> {
    const params = new URLSearchParams({ limit: "100" });
    return (await this.get<Page<Collection>>("collections", params)).items;
  }

  /** Effective membership: rule ∪ pins − excludes, ordered.
   *  spec: docs/model/L1-model#collection-algebra */
  async members(collectionSlug: string): Promise<MemberEntry[]> {
    const out: MemberEntry[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ collection: `eq.${collectionSlug}`, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const page = await this.get<Page<MemberEntry>>("membership", params);
      out.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor);
    return out;
  }

  // ── components & usages ─────────────────────────────────────────────

  async components(): Promise<Manifest[]> {
    return (await this.get<Page<Manifest>>("components", new URLSearchParams({ limit: "100" })))
      .items;
  }

  async usages(name?: string): Promise<Usage[]> {
    const params = new URLSearchParams({ limit: "100" });
    if (name) params.set("name", `eq.${name}`);
    return (await this.get<Page<Usage>>("usages", params)).items;
  }

  // ── assets ──────────────────────────────────────────────────────────

  async assets(prefix?: string): Promise<Asset[]> {
    const params = new URLSearchParams({ limit: "100" });
    if (prefix) params.set("path", `prefix.${prefix}`);
    return (await this.get<Page<Asset>>("assets", params)).items;
  }

  assetUrl(path: string): string {
    return `${this.opts.baseUrl}/api/content/${this.opts.vaultId}/assets/raw/${path}`;
  }

  // ── export ──────────────────────────────────────────────────────────

  /** The trust guarantee, composed from the grammar: every visible doc
   *  with its raw markdown. A folder of markdown you can walk away with. */
  async export(): Promise<{ slug: string; text: string }[]> {
    const docs = await this.allDocs({ include: ["body"] });
    return docs.map((d) => ({ slug: d.slug, text: d.text ?? "" }));
  }

  // ── liveness ────────────────────────────────────────────────────────

  /** Subscribes to the vault's SSE change feed; returns an unsubscribe.
   *  Fetch-stream based so it works in SSR runtimes without EventSource.
   *  spec: docs/platform/L1-platform#sse-feed */
  subscribe(
    onChange: (change: Change) => void,
    onError?: (e: unknown) => void,
  ): () => void {
    const controller = new AbortController();
    void (async () => {
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        if (this.opts.key) headers["Authorization"] = `Bearer ${this.opts.key}`;
        const res = await this.fetchImpl(
          `${this.opts.baseUrl}/api/content/${this.opts.vaultId}/events`,
          { headers, signal: controller.signal },
        );
        if (!res.ok || !res.body) throw new WitError(res.status, "sse connect failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const event = frame.match(/^event: (.+)$/m)?.[1];
            const data = frame.match(/^data: (.+)$/m)?.[1];
            if (event === "change" && data) {
              this.invalidate();
              onChange(JSON.parse(data) as Change);
            }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) onError?.(e);
      }
    })();
    return () => controller.abort();
  }
}

export function createClient(opts: WitClientOptions): WitClient {
  return new WitClient(opts);
}
