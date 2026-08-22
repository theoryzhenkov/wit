-- P2 content API support: full-text search vector (indexed on save, by
-- construction: generated column) and the indexes the query grammar
-- compiles against — every accepted operator must be index-served.
-- spec: docs/platform/L1-platform#fts-operator / #grammar-indexed

ALTER TABLE "docs" ADD COLUMN "search_vec" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("text", '')) || array_to_tsvector("tags")
  ) STORED;
--> statement-breakpoint
CREATE INDEX "docs_search_idx" ON "docs" USING gin ("search_vec");--> statement-breakpoint
CREATE INDEX "docs_tags_idx" ON "docs" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "docs_frontmatter_idx" ON "docs" USING gin ("frontmatter");--> statement-breakpoint
CREATE INDEX "docs_vault_updated_idx" ON "docs" USING btree ("vault_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "docs_vault_created_idx" ON "docs" USING btree ("vault_id","created_at","id");--> statement-breakpoint
CREATE INDEX "docs_vault_title_idx" ON "docs" USING btree ("vault_id","title","id");--> statement-breakpoint
CREATE INDEX "edges_vault_created_idx" ON "edges" USING btree ("vault_id","created_at","id");--> statement-breakpoint
CREATE INDEX "component_usages_vault_idx" ON "component_usages" USING btree ("vault_id","id");
