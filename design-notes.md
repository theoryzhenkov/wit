---
scope: L0
summary: "Dated log of design decisions, their rationale, and the roads not taken"
modified: 2026-08-22
reviewed: 2026-08-22
depends:
  - path: docs/L0-vision
---

# Design notes

Interview log. Append dated entries when a decision is made; record rejected
alternatives so they are not relitigated by accident.

## 2026-08-22 — registry is sync-owned: manual UI manifests removed

Supersedes parts of the two entries below. Since every component requires a
repo implementation regardless, manual manifest editing in the UI was a
parallel authoring path maintaining machinery (the `source: sync|manual`
field, overlays, a manifest management screen, the `scaffold` codegen
command) whose payoff code already provides — labels and docs live in JSDoc
and are extracted by sync. Removed all of it: the registry is written only by
`wit components sync`, the UI only reads it (slash-menu forms). Sync upgraded
from warn-only to full reconciliation (additions, prop updates, pruning of
unmapped manifests) with warnings when pruned/changed components still have
usages. The design-first workflow is gone as a feature — hand-typed
directives before a component exists remain possible, since directives are
just text. Noted for P2: hosted-garden built-in components will be
system-provided manifests, a separate mechanism, not a reason to resurrect
user-manual editing.

## 2026-08-22 — components: directives, registry, sync

Raised post-interview: theor.net's files are .mdx with custom Astro
components, and authors shouldn't hand-write component tags anyway.

- **Rejected storing MDX** — code-in-content: renderable only by a JS
  toolchain, unsafe to execute for multi-user (forecloses the P2 hosted
  face), hand-authored. Adopted **markdown directives** (CommonMark
  extension): a component use is data (name + attrs + slot), portable, inert,
  Obsidian-degradable. Law recorded as model MUST `content-is-data`.
- **Registry + schema-driven forms in v1** (Portable Text lineage): vault
  manifests (name, props schema, slots); editor slash-menu generates forms
  from schemas; nobody hand-types directives unless they want to.
- **Sync design**: the adapter's `wit.config` component map (directive name →
  implementation) is the single source for render-binding AND `wit components
  sync`, which TS-introspects only mapped components. Opt-in by construction;
  drift warnings both directions. Manual manifests plus overlays on synced
  ones (overlays survive re-sync). Rejected: sweeping the components folder
  (junk manifests, exposes internals), annotation markers (second declaration
  to maintain).
- **Amendments**: grammar grows 5 → 7 nouns (+components, +usages — usage
  index makes prop-breaking refactors enumerable); API keys gain scopes
  read | write (read-only-keys rule was written for site consumption; CLI
  sync and the migration script need write).
- Migration consequence: component-using MDX converts mechanically
  (JSX → directives); only pages with genuine inline logic stay repo-managed.
- **Sync is one-directional** (follow-up question: should manual UI manifests
  sync back into wit.config?): no — code → data by extraction, never
  data → code by sync. wit.config is developer-owned source; a CLI mutating it
  is the two-way-sync tar pit. Manual manifests are *design-first*
  components — authorable immediately (forms, usage indexing, fallback
  rendering), drift-warned until implemented; the explicit reverse is codegen
  (`wit components scaffold <name>`, v1.x), which the developer runs and
  commits. Recorded as platform MUST `sync-one-way`.

## 2026-08-22 — v1 interview: scope, structure, API

Five-round interview producing the v1 specs (docs/model, docs/platform,
docs/product, EPH-PLAN-L1-v1). Decisions and the roads not taken:

- **Multi-user from day one** (over single-owner instance): accounts, open
  rate-limited signup, vault membership table with roles — chosen consciously
  despite the heavier v1; collaboration later is a row insert, not a
  migration.
- **File-sync daemon deferred to v1.x**: v1 doors are web editor + API only.
  Seeding theor.net content is a one-off script through the API door, not an
  import feature.
- **Yjs from day one** (over server-truth autosave): multi-tab/device safety
  now; daemon and collaboration plug into the same protocol later.
- **Structure: flat library + collections as views.** Explicitly rejected the
  filesystem's single-parent trap. Docs are flat with UUID identity and
  vault-unique slugs; collections are ordered many-to-many views with
  effective membership = rule ∪ pins − excludes (lineage: Are.na channels ×
  smart playlists × Zettelkasten flatness; also the old Thingspace "lens"
  reborn in single-player form). Rejected: per-collection slugs (murky
  identity), collection nesting in v1 (quietly rebuilds the filesystem),
  strict stub-creating links (clutter). Links resolve to IDs at save; renames
  mint redirects; dangling links held by name and auto-resolved.
- **Content API: query grammar over five nouns** (docs, collections,
  membership, edges, assets), PostgREST/Supabase lineage — rejected
  capability-per-endpoint APIs outright. GraphQL explained and rejected for
  v1: POST-shaped queries break the ETag/CDN caching story that the chosen
  SSE + ETag liveness model relies on; resolver N+1/cost-control machinery
  outweighs a five-noun surface; consumers (SSR adapters) fetch flat lists,
  not deep nests. A GraphQL facade over the same core stays addable; the
  reverse migration would not be.
- **Raw markdown out**: sites own rendering; wit renders no HTML in v1 (the
  hosted-garden face will, in P2).
- **Stack**: one Bun process (Hono + native ws Yjs relay + Vite/React SPA
  editor), drizzle/Postgres, one container on tars — Next.js rejected for the
  websocket sidecar it would force.
- **Editor tier: comfortable** (list, edit, visibility, collections UI,
  search, uploads; frontmatter as raw text). Rich tier (frontmatter forms,
  graph view, palette) explicitly v1.x.
- **Acceptance**: dogfood cutover — theor.net garden collections SSR from
  wit, edit live ≤5s, all derivation API-driven, plus a stranger can sign up
  and publish.

## 2026-08-22 — founding: the road to wit

The project emerged from a multi-day design exploration ("Thingspace") that
crossed several visions before converging. The trail, and why each turn was
taken:

1. **Vault-first PKM platform** (own block editor, per-user typed ontologies,
   embedding-neighborhood identity, lenses/threads on saved queries).
   *Rejected*: value gated behind adopting a new practice — the graveyard
   pattern (federated wiki, Athens, Subconscious/Noosphere, the Agora). Every
   such project was infrastructure for a rare practice, not a product for a
   need; the market caps at the practice population.
2. **Embedding neighborhoods as concept identity.** *Rejected on technical
   honesty*: embeddings retrieve and match well but cluster short heterogeneous
   notes poorly (surface-topic dominance, no stable granularity, model drift,
   unexplainable neighbors). Standing principle: discrete anchors (names,
   links) carry identity; embeddings only suggest.
3. **Inter-community layer** (Discord-first community brain + cross-server
   commons). *Parked, not rejected*: strongest adoption story against network
   effects (adopt communities, not individuals), but problem excavation showed
   the founder's felt pain was elsewhere; no committed direction without a
   bleeding instance.
4. **Defiltered Agora** (hosted shared knowledge base, one filter: keeping a
   garden). *Absorbed*: its mechanics survive as the P3 commons layer. The
   Agora's failure analysis (four practice filters, no reader-side product, no
   loop, manifesto packaging) is the negative spec for P2/P3.
5. **The felt instance that settled it**: the founder's own garden at
   theor.net — Astro static site where every edit is open-files → frontmatter
   → commit → build → deploy. First proposal of the whole exploration anchored
   in a concrete daily pain. Generalized (rather than solved point-wise) into
   the backbone vision: decouple writing from rendering, for everyone who
   keeps or would keep a garden.

Key adopted decisions, with alternatives:

- **CRDT sync core, server-readable** (Yjs-class, Postgres). Local-first
  ownership story with hosted-editor UX; server-readable chosen over E2EE so
  one pipeline serves vault search and the commons (E2EE addable later).
  Rejected: git-as-sync (the friction being removed), files-as-truth-only (no
  web/phone editing).
- **Files remain a first-class door.** The vault daemon syncs plain markdown in
  an existing Obsidian vault; no editor monopoly. "Own the editor" ambition
  from the early vision was cut to "own the product surface".
- **Ladder sequencing** (substrate → platform → commons) with the
  single-player-shadow principle: each rung valuable alone; commons mechanics
  arrive last and opt-in.
- **Dogfood-first**: P1's exit criterion is theor.net running on wit. The
  founder is user #1 with daily need — the property every earlier vision
  lacked.

## 2026-08-22 — naming: wit

Requirements evolved across the naming session: common word (rare words like
*garth*, *swale*, *wardian* rejected as unmemorizable), not garden-rooted
aesthetically (*trellis*, *loam*, etc. rejected on vibe; most `.garden` domains
taken anyway), not a direct civic word (*atrium*, *plaza*, *forum* rejected as
too on-the-nose), Agora-lineage preferred, smart hidden reference desired
("thing" — the Norse assembly — liked in kind but rejected as unmemorable).

**wit** won: from Old English *witan*, "to know" (wisdom, witness, German
*wissen*); the **Witenagemot** was the Anglo-Saxon assembly of the wise — an
assembly literally named for knowing. A three-letter common word carrying both
halves of the project: knowledge and the gathering place. Hosted at
`wit.theor.net` (subdomain prefix, no domain purchase).

Runners-up, recorded: *commonplace* (triple pun — commonplace book tradition /
common place = agora / humble register — lost on length and namespace grazing:
commonplace.id PKM app, commonplace.is civic platform); *lore* (alive in
current culture, folklore = the folk's knowledge commons — lost for naming the
knowledge but not the place); *fold*, *quorum*, *chorus*, *moot*, *veche*.
**thingspace** survives as the name of the P3 commons layer, where it is
doubly earned: the space of things, and the space of assembly.
