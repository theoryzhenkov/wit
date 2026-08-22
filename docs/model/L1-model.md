---
scope: L1
summary: "The wit data model: users, vaults, docs, collections, edges, assets, and the invariants that hold them together"
modified: 2026-08-22
reviewed: 2026-08-22
depends:
  - path: docs/L0-vision
dependents:
  - path: docs/platform/L1-platform
  - path: docs/product/L1-product
---

# Model

The structural law of wit: **a flat library, with collections as views — never
containers.** Identity and organization are fully decoupled. Text is truth;
everything queryable is a derived index.

## Users & vaults

A user account (magic-link auth) can belong to any number of vaults. A vault is
the unit of ownership, sync, API scoping, and (later) file mapping. Membership
is a table with roles from day one — collaboration later is a row insert, not a
migration.

### Assertions

| ID               | Sev. | Assertion                                                                 |
| ---------------- | ---- | ------------------------------------------------------------------------- |
| vault-owner      | MUST | Every vault has at least one member with role `owner`                     |
| vault-access     | MUST | Reading or writing vault contents requires membership, except published content via API key |
| signup-open      | MUST | Signup is open via magic link and rate-limited per IP                     |

## Docs

A doc is a UUID + a vault + a vault-unique slug + a Yjs text body. Docs are
flat: no doc is inside anything. Frontmatter lives inside the body text
(Obsidian round-trip compatible); on save it is parsed into indexed columns
(fields JSONB, tags array). The optional `path` column is reserved for the
file-sync daemon (v1.x) and unused by the web flow.

### Assertions

| ID              | Sev. | Assertion                                                                  |
| --------------- | ---- | -------------------------------------------------------------------------- |
| doc-identity    | MUST | A doc's identity is its UUID; slug or organization changes never change it |
| slug-unique     | MUST | Slugs are normalized (lowercase kebab) and unique within a vault           |
| text-is-truth   | MUST | The doc text (including its frontmatter block) is the source of truth; parsed frontmatter, tags, and edges are derived on save and never diverge from it |
| rename-redirect | MUST | Changing a slug creates a redirect record; the old slug resolves to the doc |
| doc-private-default | MUST | New docs are private                                                   |

## Collections

A collection is a first-class object in a vault: a slug, an optional stored
**rule** (a query over tags/frontmatter/text), and explicit **pins** and
**excludes**. Effective membership = rule matches ∪ pins − excludes. Pins carry
explicit order; rule matches follow the collection's sort key. Collections are
flat in v1 (no nesting) and are the unit sites consume.

### Assertions

| ID                  | Sev. | Assertion                                                        |
| ------------------- | ---- | ---------------------------------------------------------------- |
| collection-algebra  | MUST | Effective membership = rule matches ∪ pins − excludes            |
| collection-many     | MUST | A doc may belong to any number of collections                    |
| collection-order    | MUST | Pinned members have explicit positions; rule matches are ordered by the collection's sort key |
| collection-flat     | MUST | Collections do not nest in v1                                    |

## Links & edges

Body wikilinks (`[[slug]]`) and typed frontmatter relations (`up`, `is`, …)
both produce rows in one edge table, distinguished by type. Links resolve to
doc UUIDs at save time; links to nonexistent slugs are held by name and
auto-resolve when a matching doc appears. Backlinks and the graph are reads
over this table, never stored redundantly.

### Assertions

| ID               | Sev. | Assertion                                                                |
| ---------------- | ---- | ------------------------------------------------------------------------ |
| link-resolve     | MUST | Links resolve to target doc UUIDs at save time when the target slug exists |
| link-dangling    | MUST | Links to nonexistent slugs are stored by name and auto-resolve when a matching doc is created |
| edge-typed       | MUST | Frontmatter relations produce typed edges distinct from body wikilinks   |
| backlinks-derived | MUST | Backlinks are derived from the edge table on read                       |

## Visibility

Per-doc, three tiers, private by default: `private` (members only), `unlisted`
(fetchable by slug through the content API, excluded from listings and
search), `public` (fully served). Assets carry the same tiers.

### Assertions

| ID                   | Sev. | Assertion                                                            |
| -------------------- | ---- | -------------------------------------------------------------------- |
| visibility-tiers     | MUST | private = members only; unlisted = direct fetch only, never in listings or search; public = fully served |
| private-never-served | MUST | Private docs and assets never appear in any content API response     |

## Assets

Uploaded files (images first) addressed by vault + path, stored in object
storage (disk in v1), referenced from doc bodies, subject to visibility.

### Assertions

| ID           | Sev. | Assertion                                            |
| ------------ | ---- | ---------------------------------------------------- |
| asset-coords | MUST | Assets are addressed by vault + path                 |
| asset-visibility | MUST | Asset serving respects the same visibility tiers as docs |
