---
scope: L0
summary: "Why wit exists: the friction thesis, the three doors and three faces, and the ladder to the commons"
modified: 2026-08-22
reviewed: 2026-08-22
dependents:
  - path: design-notes
  - path: docs/model/L1-model
  - path: docs/platform/L1-platform
  - path: docs/product/L1-product
---

# Wit — Vision

## The problem

Keeping a digital garden today means choosing an architecture before writing a
word. Obsidian Publish gives you their design and no API. Quartz gives you your
design and a git+CI ritual on every edit. Notion gives you ease and takes your
files. A custom static site (the founding dogfood case: theor.net) gives you
everything and makes each edit a process — open files, write frontmatter,
commit, build, deploy. The choice of renderer captures the content, and the
friction of the loop suppresses the practice. The population of would-be
gardeners is far larger than the population of gardeners; tooling is the
difference. Newsletters were a geek practice until Substack collapsed the
friction; gardens are in their pre-Substack moment.

## The bet

**Decouple writing a garden from rendering a garden.** Wit is a garden-native
content backbone with standard connectors on both ends. Content lives in a
synced core; where you write and where it is seen are both pluggable, and
neither captures the other.

## Three doors in, three faces out

Doors (where you write):

1. **Web editor** — CRDT-native, works on a phone, autosave by nature.
2. **Vault sync** — a folder daemon (later an Obsidian plugin) watching plain
   markdown files inside an existing vault. Files are the compatibility layer:
   any editor works.
3. **API** — scripts and agents tend the garden through the same interface.

Faces (where it is seen):

1. **Hosted garden** — themes, graph, search, RSS, zero config. The door for
   people who will never run a site.
2. **SDK + framework loaders** — content-as-a-service behind your own design
   (Astro first, for the dogfood). The backbone maintains live indexes —
   search, backlinks, typed relations, the link graph — replacing the
   derivation scripts every custom garden reimplements at build time.
3. **Static export** — the trust guarantee. A garden is always, at any moment,
   a folder of markdown you can walk away with.

## The core

CRDT documents (markdown + frontmatter) in Postgres, synced through a
server-readable relay; per-note visibility (private / unlisted / public) —
gardens are partial publications; wikilinks and backlinks as first-class
server-maintained objects; typed relations declared in frontmatter and indexed
as edges; full-text search indexed on sync. Boring infrastructure, deliberately:
one database, one process family, self-hostable.

## The ladder

Each rung is independently valuable; no rung depends on the one above arriving.

1. **Substrate** — the sync core, editor, vault daemon, and SDK. Solves the
   founder's own writing loop. One user is enough to justify it.
2. **Platform** — hosted gardens for the practice population ("Substack for
   digital gardens"). The Obsidian plugin channel reaches exactly this
   audience.
3. **Commons — "thingspace"** — opt-in cross-garden resolution: shared names,
   node pages, collision notifications ("3 other gardens have notes here").
   The Agora's mechanic, productized, arriving only after single-player value
   is proven. The working title of the whole exploration survives as this
   layer's name.

## Principles

- **Single-player shadow**: every social mechanic must have a solo form that is
  useful alone; multiplayer is an unlock, never a prerequisite.
- **Discrete anchors, fuzzy suggestion**: identity lives in names and links —
  human-legible, stable. Embeddings and models only *propose* (related notes,
  merge candidates); a human confirms. No emergent clustering as ontology.
- **Contribution is exhaust**: the commons is fed by notes people already
  write, never by an extra practice.
- **The export face is sacred**: lock-in is forbidden by architecture, not by
  promise.

## Risks

- Obsidian could ship Publish-with-API; wit's answers are input neutrality,
  the SDK face, and the commons — things a walled publisher structurally
  avoids.
- The vault daemon's file↔CRDT bridge is the hardest 10% (renames, atomic
  writes, offline reconciliation); it is a proven pattern but must be built
  carefully.
- The site face makes theor.net depend on wit's uptime; mitigated by
  stale-while-revalidate caching and the static export as standing fallback.
- Ecosystem framings invite sprawl; each phase ships exactly one door or one
  face.

## Phase map

- **P1 — substrate (dogfood)**: sync server + content API with API keys; web
  editor; vault folder daemon; Astro content loader; live search / backlink /
  relation / graph indexes. Exit criterion: theor.net's garden pages are served
  from wit, and an edit in Obsidian or the web editor is live in seconds with
  no commit and no deploy.
- **P2 — platform**: accounts, hosted garden rendering with themes, imports
  (Obsidian vaults, static-site repos), the Obsidian plugin proper.
- **P3 — commons (thingspace)**: per-note publish to the commons, cross-garden
  name resolution, node pages, collision notifications.
