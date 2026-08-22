-- Yjs update log: append-only per-doc CRDT updates, periodically
-- compacted into a single merged row (docs/platform/L1-platform#yjs-persist).
-- Hand-written; keep in sync with src/lib/db/schema.ts.

CREATE TABLE "doc_updates" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"doc_id" uuid NOT NULL,
	"update" bytea NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_updates_doc_idx" ON "doc_updates" USING btree ("doc_id","seq");
