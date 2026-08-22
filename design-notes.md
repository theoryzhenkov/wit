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
