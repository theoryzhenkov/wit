---
scope: L1
summary: "Build plan for wit v1: six phases from scaffold to theor.net cutover"
modified: 2026-08-22
reviewed: 2026-08-22
lifecycle: ephemeral
type: PLAN
status: accepted
depends:
  - path: docs/model/L1-model
  - path: docs/platform/L1-platform
  - path: docs/product/L1-product
---

# Plan — v1

Phases in dependency order; each exits with gates green (typecheck, tests,
build).

## P0 — scaffold

Bun + Hono app skeleton; drizzle schema + hand-written migrations for users,
vaults, vault_members, docs, collections, collection_items, edges, redirects,
assets, api_keys; better-auth magic links; CI (bun test with Postgres
service). Exit: a user can sign up and create a vault.

## P1 — doc core

Yjs relay (websocket) + update persistence + snapshot compaction; save
pipeline: derive markdown text → parse frontmatter/tags → resolve links →
upsert edges → parse directives → upsert usages; slug normalization +
uniqueness + rename redirects. Exit: docs round-trip through Yjs with all
derived indexes correct (model assertions covered by tests).

## P2 — collections & content API

Collection algebra (rule ∪ pins − excludes, ordering); the query grammar over
the seven nouns with filters/fts/includes/order/cursors; ETags; per-vault SSE
feed; scoped API keys (read | write) with visibility enforcement; component
registry CRUD (manifests, overlays). Exit: platform grammar assertions
covered; a public doc is readable by a read key, a private one provably is
not; a write key can manage the registry.

## P3 — editor

Vite/React SPA at the comfortable tier: doc list, CodeMirror + Yjs editing,
create/rename/delete, visibility toggle, collections UI, search, drag-drop
uploads, component slash-menu with schema-driven insert/edit forms, manifest
management UI (manual manifests + overlays), directive diagnostics. Exit:
daily-drivable for real writing, components included.

## P4 — SDK, adapter, cutover

`@wit/client` typed helpers; Astro adapter (SSR fetch + SSE invalidation +
stale-while-revalidate + directive→component rendering from the wit.config
map); `wit components sync` CLI (TS Props introspection); migration script
seeding theor.net's garden collections with JSX→directive conversion;
theor.net garden routes flip to SSR-from-wit; delete the site's derivation
scripts. Exit: product acceptance assertions accept-cutover, accept-live,
accept-derived.

## P5 — hardening & deploy

Rate limits and input caps; upload limits; deploy container to tars
(ops_atlas); open signup live. Exit: accept-stranger; v1 done.
