import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// docs/model/L1-model entities: users & vaults, docs, collections, edges,
// components, visibility, assets — plus the better-auth core tables and
// api_keys (docs/platform/L1-platform "Auth & limits").
//
// Text is truth: frontmatter, tags, edges, and usages columns are derived
// from doc text on save and never hand-written.
// spec: docs/model/L1-model#text-is-truth

// ── Enums ─────────────────────────────────────────────────────────────

// spec: docs/model/L1-model#visibility-tiers
export const visibility = pgEnum("visibility", ["private", "unlisted", "public"]);
export const vaultRole = pgEnum("vault_role", ["owner", "editor"]);
export const collectionItemKind = pgEnum("collection_item_kind", ["pin", "exclude"]);
// spec: docs/model/L1-model#edge-typed
export const edgeKind = pgEnum("edge_kind", ["wikilink", "relation"]);
// spec: docs/platform/L1-platform#api-key-scope
export const apiKeyScope = pgEnum("api_key_scope", ["read", "write"]);

// Slugs are normalized lowercase kebab; the check makes the un-normalized
// form unstorable. spec: docs/model/L1-model#slug-unique
const SLUG_RE = "^[a-z0-9]+(-[a-z0-9]+)*$";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ── better-auth core tables ───────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Vaults ────────────────────────────────────────────────────────────
// The unit of ownership, sync, and API scoping.

export const vaults = pgTable("vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Membership is a table with roles from day one — collaboration later is
// a row insert, not a migration. The every-vault-has-an-owner invariant
// is enforced by the store (creation is vault+owner in one transaction).
// spec: docs/model/L1-model#vault-owner
export const vaultMembers = pgTable(
  "vault_members",
  {
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: vaultRole("role").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.userId] }),
    // "Which vaults am I in" is the common entry query.
    index("vault_members_user_idx").on(t.userId),
  ],
);

// ── Docs ──────────────────────────────────────────────────────────────
// Flat: no doc is inside anything. Identity is the UUID; slug and
// organization changes never touch it. spec: docs/model/L1-model#doc-identity

export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    // The source of truth, frontmatter block included. Yjs update storage
    // arrives with the P1 save pipeline; this column is the derived
    // markdown the platform serves. spec: docs/model/L1-model#text-is-truth
    text: text("text").notNull().default(""),
    // Derived on save, never hand-edited:
    title: text("title").notNull().default(""),
    frontmatter: jsonb("frontmatter").notNull().default({}),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Reserved for the file-sync daemon (v1.x); unused by the web flow.
    path: text("path"),
    // Generated always (0002): title + text + tags, indexed on save by
    // construction. spec: docs/platform/L1-platform#fts-operator
    searchVec: tsvector("search_vec"),
    // spec: docs/model/L1-model#doc-private-default
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // spec: docs/model/L1-model#slug-unique
    uniqueIndex("docs_vault_slug_idx").on(t.vaultId, t.slug),
    check("docs_slug_kebab", sql`${t.slug} ~ '${sql.raw(SLUG_RE)}'`),
  ],
);

// ── Yjs update log ────────────────────────────────────────────────────
// Append-only CRDT updates per doc, periodically compacted into one
// merged row. The doc's markdown `text` is derived from the merged
// state on save and never diverges from it.
// spec: docs/platform/L1-platform#yjs-persist

export const docUpdates = pgTable(
  "doc_updates",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    update: bytea("update").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("doc_updates_doc_idx").on(t.docId, t.seq)],
);

// ── Collections ───────────────────────────────────────────────────────
// Views, never containers. No parent column exists: nesting is
// unrepresentable. spec: docs/model/L1-model#collection-flat

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull().default(""),
    // Stored query over tags/frontmatter/text; null = pins only.
    // Effective membership = rule matches ∪ pins − excludes.
    // spec: docs/model/L1-model#collection-algebra
    rule: jsonb("rule"),
    // Sort key applied to rule matches (pins carry explicit positions).
    // spec: docs/model/L1-model#collection-order
    sortKey: text("sort_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("collections_vault_slug_idx").on(t.vaultId, t.slug),
    check("collections_slug_kebab", sql`${t.slug} ~ '${sql.raw(SLUG_RE)}'`),
  ],
);

// Pins and excludes; rule matches are computed, never stored.
// spec: docs/model/L1-model#collection-many — membership is many-to-many.
export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    kind: collectionItemKind("kind").notNull(),
    position: integer("position"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.docId] }),
    index("collection_items_doc_idx").on(t.docId),
    // Pins have explicit positions; excludes have none.
    // spec: docs/model/L1-model#collection-order
    check("collection_items_pin_position", sql`(${t.kind} = 'pin') = (${t.position} is not null)`),
  ],
);

// ── Edges ─────────────────────────────────────────────────────────────
// Body wikilinks and typed frontmatter relations in one table,
// distinguished by kind. Derived from doc text on save; backlinks and
// the graph are reads over this table, never stored redundantly.
// spec: docs/model/L1-model#backlinks-derived

export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized from the source doc: every grammar query is
    // vault-scoped and must not join for it.
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    sourceDocId: uuid("source_doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    // spec: docs/model/L1-model#edge-typed
    kind: edgeKind("kind").notNull(),
    // Relation name (`up`, `is`, …) when kind = relation.
    rel: text("rel"),
    // Held by name always; resolved to a UUID when the target exists.
    // Deleting the target reverts the edge to dangling (set null), from
    // where it auto-resolves again. spec: docs/model/L1-model#link-resolve
    targetSlug: text("target_slug").notNull(),
    targetDocId: uuid("target_doc_id").references(() => docs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("edges_source_idx").on(t.sourceDocId),
    // Backlinks: incoming edges for a doc. spec: docs/model/L1-model#backlinks-derived
    index("edges_target_idx").on(t.targetDocId),
    // Dangling links by name, probed when a doc is created.
    // spec: docs/model/L1-model#link-dangling
    index("edges_dangling_idx")
      .on(t.vaultId, t.targetSlug)
      .where(sql`${t.targetDocId} is null`),
    check("edges_relation_rel", sql`(${t.kind} = 'relation') = (${t.rel} is not null)`),
  ],
);

// ── Redirects ─────────────────────────────────────────────────────────
// Renaming a slug mints a redirect; the old slug resolves to the doc.
// spec: docs/model/L1-model#rename-redirect

export const redirects = pgTable(
  "redirects",
  {
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    oldSlug: text("old_slug").notNull(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.oldSlug] }),
    index("redirects_doc_idx").on(t.docId),
  ],
);

// ── Assets ────────────────────────────────────────────────────────────
// Addressed by vault + path; bytes live in object storage (disk in v1).
// spec: docs/model/L1-model#asset-coords

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    // spec: docs/model/L1-model#asset-visibility
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assets_vault_path_idx").on(t.vaultId, t.path)],
);

// ── API keys ──────────────────────────────────────────────────────────
// Vault-scoped, hashed at rest (the token is shown once, stored never).
// spec: docs/platform/L1-platform#api-key-scope

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    scope: apiKeyScope("scope").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [index("api_keys_vault_idx").on(t.vaultId)],
);

// ── Component registry ────────────────────────────────────────────────
// Vault-scoped manifests, written only by `wit components sync` (the P2
// push endpoint is sync's write target); the UI reads, never writes.
// spec: docs/model/L1-model#registry-manifests

export const componentManifests = pgTable(
  "component_manifests",
  {
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    // Directive name, as invoked in doc bodies (::name{…}).
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Props schema extracted from the component's TS Props type.
    props: jsonb("props").notNull().default({}),
    // Slot expectations (leaf / container markdown slot / inline text).
    slots: jsonb("slots"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.name] })],
);

// Directive usages, derived from doc text on save. No FK to manifests:
// usages of unknown directives are valid data (diagnostics are advisory,
// never save failures). spec: docs/model/L1-model#usage-index

export const componentUsages = pgTable(
  "component_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    props: jsonb("props").notNull().default({}),
  },
  (t) => [
    index("component_usages_doc_idx").on(t.docId),
    // "Which docs use component X" — the prop-refactor enumeration query.
    index("component_usages_name_idx").on(t.vaultId, t.name),
  ],
);
