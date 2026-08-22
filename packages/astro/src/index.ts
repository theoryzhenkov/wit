import {
  WitClient,
  createClient,
  type Doc,
  type MemberEntry,
  type WitClientOptions,
} from "@wit/client";

// @wit/astro — content-as-a-service behind your own design. Two shapes:
//
// 1. witLoader(): an Astro content-collection Loader (build-time /
//    dev-refresh), structurally typed so this package needs no astro dep.
// 2. WitSsr: a stale-while-revalidate cache over @wit/client for SSR
//    routes, invalidated by the vault's SSE feed. This is the path by
//    which an editor save reaches a consuming SSR site.
//    spec: docs/platform/L1-platform#sse-feed
//
// Directive → component rendering stays in the site: the same
// wit.config components map that `wit components sync` reads binds
// directive names to implementations (remark-directive on the site's
// side). This package never renders HTML.
// spec: docs/platform/L1-platform#markdown-out

export { createClient, WitClient };
export type { Doc, MemberEntry, WitClientOptions };

// ── Astro Loader (structural subset of astro/loaders) ─────────────────

interface LoaderDataStore {
  clear(): void;
  set(entry: { id: string; data: Record<string, unknown>; body?: string; digest?: string }): boolean;
}

interface LoaderContext {
  store: LoaderDataStore;
  logger: { info(msg: string): void; warn(msg: string): void };
  generateDigest(data: unknown): string;
}

export interface WitLoader {
  name: string;
  load(context: LoaderContext): Promise<void>;
}

export interface WitLoaderOptions extends WitClientOptions {
  /** Restrict to one collection's effective membership; omit for all
   *  visible docs. */
  collection?: string;
}

/** An Astro content-collection loader over the grammar. Entry id = slug;
 *  body = raw markdown; data = frontmatter + doc metadata. */
export function witLoader(opts: WitLoaderOptions): WitLoader {
  const client = createClient(opts);
  return {
    name: `wit:${opts.collection ?? "docs"}`,
    async load({ store, logger, generateDigest }) {
      let docs: Doc[];
      if (opts.collection) {
        const members = await client.members(opts.collection);
        docs =
          members.length > 0
            ? await client.allDocs({
                slug: { in: members.map((m) => m.slug) },
                include: ["body"],
              })
            : [];
        // Preserve the algebra's order (pins first, then rule matches).
        const order = new Map(members.map((m, i) => [m.slug, i]));
        docs.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
      } else {
        docs = await client.allDocs({ include: ["body"] });
      }
      store.clear();
      for (const doc of docs) {
        store.set({
          id: doc.slug,
          data: {
            ...doc.frontmatter,
            slug: doc.slug,
            title: doc.title,
            tags: doc.tags,
            updatedAt: doc.updatedAt,
            witId: doc.id,
          },
          body: doc.text ?? "",
          digest: generateDigest(doc.updatedAt + doc.slug),
        });
      }
      logger.info(`wit: loaded ${docs.length} doc(s)`);
    },
  };
}

// ── SSR: stale-while-revalidate keyed by the SSE feed ─────────────────

interface SsrCacheEntry<T> {
  value: T;
  fresh: boolean;
  fetchedAt: number;
}

export interface WitSsrOptions extends WitClientOptions {
  /** Hard staleness ceiling even without SSE traffic (ms). Default 5 min. */
  maxAgeMs?: number;
}

/** Serve-stale, refresh-on-invalidation cache for SSR routes. Also the
 *  standing fallback: if wit is briefly unreachable, the last good value
 *  keeps serving. */
export class WitSsr {
  readonly client: WitClient;
  private readonly cache = new Map<string, SsrCacheEntry<unknown>>();
  private readonly maxAgeMs: number;
  private stopFeed: (() => void) | null = null;

  constructor(opts: WitSsrOptions) {
    this.client = createClient(opts);
    this.maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  }

  /** Start SSE-driven invalidation; idempotent. Call once at boot. */
  listen(onError?: (e: unknown) => void): void {
    if (this.stopFeed) return;
    this.stopFeed = this.client.subscribe(() => {
      for (const entry of this.cache.values()) entry.fresh = false;
    }, onError);
  }

  close(): void {
    this.stopFeed?.();
    this.stopFeed = null;
  }

  /** Cached compute: fresh hits return instantly; stale hits return the
   *  old value while refreshing in the background; misses await. */
  async swr<T>(key: string, compute: (client: WitClient) => Promise<T>): Promise<T> {
    const entry = this.cache.get(key) as SsrCacheEntry<T> | undefined;
    const now = Date.now();
    if (entry) {
      const expired = now - entry.fetchedAt > this.maxAgeMs;
      if (entry.fresh && !expired) return entry.value;
      // Stale: serve, refresh behind the response.
      void compute(this.client)
        .then((value) => {
          this.cache.set(key, { value, fresh: true, fetchedAt: Date.now() });
        })
        .catch(() => {
          // Keep serving stale — the export face is the real fallback.
        });
      return entry.value;
    }
    const value = await compute(this.client);
    this.cache.set(key, { value, fresh: true, fetchedAt: now });
    return value;
  }

  doc(slug: string) {
    return this.swr(`doc:${slug}`, (c) => c.doc(slug, ["body", "backlinks"]));
  }

  members(collection: string) {
    return this.swr(`members:${collection}`, (c) => c.members(collection));
  }

  search(query: string) {
    // Search is user-driven; cache briefly under its own key.
    return this.swr(`search:${query}`, (c) => c.search(query));
  }
}
