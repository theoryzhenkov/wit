import { defineConfig } from "drizzle-kit";

// For `drizzle-kit check` only — migrations are hand-written in ./drizzle,
// never generated or pushed (docs/platform/L1-platform "Stack").
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://linker@localhost:5433/wit",
  },
});
