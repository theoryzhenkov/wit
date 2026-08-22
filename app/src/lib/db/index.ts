import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// One connection pool per process (one Bun process serves everything).
const client = postgres(env.databaseUrl, {
  max: 10,
  connect_timeout: 10,
  idle_timeout: 30,
});

export const db = drizzle(client, { schema });
export { schema };
