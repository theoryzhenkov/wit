---
scope: L1
summary: "Stack, query-grammar API contract, liveness, auth, and deployment for wit v1"
modified: 2026-08-22
reviewed: 2026-08-22
depends:
  - path: docs/L0-vision
  - path: docs/model/L1-model
dependents:
  - path: docs/product/L1-product
---

# Platform

## Stack

One Bun process: Hono for REST, Bun's native websocket server as the Yjs relay
(y-protocols), and the editor served as a static Vite/React SPA. drizzle +
Postgres. One container, deployed to tars beside linker. Migrations are
hand-written (never `drizzle-kit push` — linker convention, generated columns
at stake here too).

### Assertions

| ID          | Sev.   | Assertion                                                       |
| ----------- | ------ | --------------------------------------------------------------- |
| one-process | SHOULD | API, Yjs relay, SSE, and editor serving run in one Bun process  |
| yjs-persist | MUST   | Yjs updates are persisted and periodically compacted; the derived markdown text is recomputed on save and never diverges from doc state |

## Content API: the query grammar

The content API exposes exactly five nouns — **docs, collections, membership,
edges, assets** — through one uniform grammar: filters (`eq`, `in`, `prefix`,
`contains`, `exists`) over slugs, tags, and frontmatter fields; an `fts`
operator; includes (`body`, `backlinks`); ordering; cursor pagination. There
are no capability-specific endpoints: backlinks, the graph, relation queries,
search, and export are all grammar queries. `@wit/client` (and the Astro
adapter built on it) provides typed helpers that compose grammar calls
client-side. Responses carry raw markdown + parsed frontmatter — rendering
belongs to consumers. GraphQL was considered and rejected for v1
(caching/liveness mismatch, resolver cost-control burden); a facade over the
same core remains addable later.

### Assertions

| ID              | Sev. | Assertion                                                              |
| --------------- | ---- | ---------------------------------------------------------------------- |
| grammar-nouns   | MUST | The content API exposes exactly the five nouns through one grammar; no capability-specific endpoints exist |
| grammar-get-etag | MUST | Every grammar query is a GET with a strong ETag; conditional requests return 304 unchanged |
| grammar-indexed | MUST | Every accepted grammar query compiles to indexed SQL; operators that cannot be served by an index are rejected, not scanned |
| fts-operator    | MUST | Full-text search is a grammar operator over title, body, and tags, indexed on save |
| markdown-out    | MUST | The content API returns raw markdown + parsed frontmatter; wit renders no HTML in v1 |
| sdk-client-side | MUST | SDK helpers (graph, backlinks, search, export) compose grammar queries client-side |

## Liveness

Per-vault SSE change feed emitting `(noun, ids, timestamp)` on every commit;
consumers drop cache entries and refetch (conditional GETs as backstop). This
is the path by which an editor save reaches a consuming SSR site.

### Assertions

| ID        | Sev.   | Assertion                                                            |
| --------- | ------ | -------------------------------------------------------------------- |
| sse-feed  | MUST   | Every vault exposes an SSE change feed emitting noun + ids after each save, without polling |
| sse-latency | SHOULD | A save reaches the SSE feed within 1 second                        |

## Auth & limits

Editor/UI auth via better-auth magic links (linker patterns). Content reads
via vault-scoped, read-only API keys. Signup per-IP rate limit; doc size and
upload size caps.

### Assertions

| ID            | Sev. | Assertion                                                             |
| ------------- | ---- | --------------------------------------------------------------------- |
| auth-editor   | MUST | Editor and management surfaces require a session (magic-link auth)    |
| api-key-scope | MUST | API keys are read-only and vault-scoped; they can access public and unlisted content only |
| input-caps    | MUST | Doc size, upload size, and signup rate are capped                     |
