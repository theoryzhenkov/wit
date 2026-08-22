import { migrateDb } from "./lib/db/migrate";
import { assertProductionEnv, env } from "./lib/env";
import { startServer } from "./server";

assertProductionEnv();
await migrateDb();

const server = startServer(env.port);

console.log(`wit listening on ${server.url}`);
