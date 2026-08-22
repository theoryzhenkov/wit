import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

// Migrations are hand-written SQL in ./drizzle (never `drizzle-kit push`);
// this applies whatever the journal lists. Runs at boot and once per test
// process. A dedicated single-use connection: the migrator must not share
// the app pool's prepared-statement cache across DDL.
export async function migrateDb(): Promise<void> {
  const client = postgres(env.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname,
    });
  } finally {
    await client.end();
  }
}
