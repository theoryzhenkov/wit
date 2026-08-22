---
scope: root
summary: "Entry point for the wit project"
modified: 2026-08-22
reviewed: 2026-08-22
dependents:
  - path: docs/L0-vision
  - path: docs/model/L1-model
  - path: docs/platform/L1-platform
  - path: docs/product/L1-product
  - path: EPH-PLAN-L1-v1
  - path: design-notes
---

# wit

A content backbone for digital gardens: write anywhere, render anywhere,
live-synced. Wit decouples *keeping* a garden from *serving* one — notes sync
from any editor (web, Obsidian vault, API) into one store, and any face (a
hosted garden, your own site via SDK, a static export) renders from it. No
commits, no builds, no deploys in the writing loop.

The name: *wit* descends from Old English *witan*, "to know" — and the
Witenagemot was the Anglo-Saxon assembly of the wise. A common word whose
hidden lineage is both knowledge and the agora.

First deployment: `wit.theor.net`, feeding the garden at theor.net.

- [docs/L0-vision.md](docs/L0-vision.md) — why wit exists, the shape, the ladder
- [docs/model/L1-model.md](docs/model/L1-model.md) — vaults, docs, collections, edges, visibility: the invariants
- [docs/platform/L1-platform.md](docs/platform/L1-platform.md) — stack, query-grammar API, liveness, auth
- [docs/product/L1-product.md](docs/product/L1-product.md) — v1 scope and acceptance bar
- [EPH-PLAN-L1-v1.md](EPH-PLAN-L1-v1.md) — the six-phase build plan
- [design-notes.md](design-notes.md) — dated log of design decisions and their rationale
