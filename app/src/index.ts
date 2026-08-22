import { app } from "./app";
import { migrateDb } from "./lib/db/migrate";
import { assertProductionEnv, env } from "./lib/env";

assertProductionEnv();
await migrateDb();

const server = Bun.serve({
  port: env.port,
  fetch: app.fetch,
});

console.log(`wit listening on ${server.url}`);
