---
scope: L1
summary: "wit v1 product scope: what ships, what waits, the editor tier, and the acceptance bar"
modified: 2026-08-22
reviewed: 2026-08-22
depends:
  - path: docs/L0-vision
  - path: docs/model/L1-model
  - path: docs/platform/L1-platform
---

# Product — v1

V1 is the **substrate rung** of the ladder: multi-user from day one, two doors
in (web editor, API), one and a half faces out (SDK/loaders for own-site
consumption; export satisfied through the grammar, not a bespoke feature). The
proof is the dogfood cutover of theor.net.

## In scope

- Accounts (open signup, rate-limited), vaults with role membership.
- Yjs CRDT docs, web editor at the **comfortable** tier: doc list,
  CodeMirror + Yjs markdown editing, create/rename/delete, visibility toggle,
  collections UI (create, pin, order, edit rules), search, drag-drop image
  upload, and component insert/edit via schema-driven forms (slash-menu from
  the registry). Frontmatter edited as raw text in the document.
- Component system: markdown directives as the invocation format, vault
  component registry (synced + manual manifests with overlays), the
  `wit components sync` CLI, and the directive usage index.
- Content API (query grammar over seven nouns), SSE + ETag liveness,
  vault-scoped API keys (read | write).
- `@wit/client` SDK + Astro adapter (markdown + directive→component
  rendering).
- Basic asset uploads (disk-backed object storage).
- One-off migration script (via the API door, write key) to seed theor.net's
  garden content, converting component JSX to directives — a dogfood script,
  not a product feature. Pages with genuine inline logic stay repo-managed.

## Out of scope (v1.x and later)

- Vault/file-sync daemon and Obsidian plugin (v1.x, first follow-up).
- Collection nesting; per-collection slugs; rendered-HTML endpoint; consumer
  webhooks; GraphQL facade; frontmatter form UI; graph view in the editor;
  version-history UI. (MDX storage is out permanently, not deferred —
  directives are the component format; see docs/model/L1-model#content-is-data.)
- Hosted-garden face (P2 platform rung); commons/thingspace (P3).

## Acceptance

### Assertions

| ID             | Sev. | Assertion                                                              |
| -------------- | ---- | ---------------------------------------------------------------------- |
| accept-cutover | MUST | theor.net's garden collections are served SSR from wit via the Astro adapter |
| accept-live    | MUST | An editor save is visible on the consuming site within 5 seconds       |
| accept-derived | MUST | Search, graph, backlinks, and relation queries on the consuming site are API-driven; no build-time derivation scripts remain for garden collections |
| accept-stranger | MUST | A stranger can sign up, create a vault, publish a public doc, and read it through the content API with their own key |
