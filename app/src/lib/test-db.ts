// Shared DB test harness (linker pattern): migrate-once guard +
// per-file namespaced fixtures. Test files never truncate shared tables
// and never assume exclusive DB ownership. Import this module before any
// app module, so the DATABASE_URL default below is set before the pool
// connects. (The harness is the sanctioned second reader of process.env.)

process.env.DATABASE_URL ??= "postgres://linker@localhost:5433/wit";

import { migrateDb } from "./db/migrate";

let migrated = false;

export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await migrateDb();
  migrated = true;
}

async function rawClient() {
  const { default: postgres } = await import("postgres");
  return postgres(process.env.DATABASE_URL!, { max: 1 });
}

export interface Fixtures {
  userId: (n: string) => string;
  email: (n: string) => string;
  vaultName: (n: string) => string;
  /** Deletes this namespace's vaults (cascading docs/collections/edges/
   *  keys) and users, then re-creates the named users directly in the DB
   *  (for schema-level tests; route tests sign up through the app). */
  reset: (userNames?: string[]) => Promise<void>;
}

export function fixtures(ns: string): Fixtures {
  const userId = (n: string) => `test-${ns}-${n}`;
  const email = (n: string) => `${ns}-${n}@test.local`;
  const vaultName = (n: string) => `test-${ns}-${n}`;
  return {
    userId,
    email,
    vaultName,
    reset: async (userNames = []) => {
      await ensureMigrated();
      const client = await rawClient();
      const idLike = `test-${ns}-%`;
      const emailLike = `${ns}-%@test.local`;
      await client`delete from vaults where name like ${idLike} or id in (
        select vm.vault_id from vault_members vm
        join users u on u.id = vm.user_id
        where u.id like ${idLike} or u.email like ${emailLike}
      )`;
      await client`delete from users where id like ${idLike} or email like ${emailLike}`;
      for (const n of userNames) {
        await client`insert into users (id, email) values (${userId(n)}, ${email(n)})`;
      }
      await client.end();
    },
  };
}
