import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };
export type Schema = typeof schema;
/** Driver-agnostic database type (postgres.js in production, PGlite in tests). Transactions are compatible. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** Works both from sources (src/db) and from the bundle (dist/). Overridable with MIGRATIONS_DIR. */
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  ['../../drizzle', '../drizzle']
    .map((p) => fileURLToPath(new URL(p, import.meta.url)))
    .find((p) => existsSync(p)) ??
  'drizzle';

export function createPostgres(url: string, max = 10) {
  const client = postgres(url, { max, onnotice: () => undefined });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, client };
}

/**
 * Waits until the database accepts connections. After a Docker daemon restart
 * containers come back in arbitrary order (depends_on only applies to
 * `compose up`), so the API/worker must tolerate a database that is still starting.
 */
export async function waitForDatabase(
  url: string,
  { timeoutMs = 60_000, intervalMs = 2_000, log = console.warn } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
    try {
      await client`select 1`;
      return;
    } catch (err) {
      if (Date.now() + intervalMs > deadline) throw err;
      log(`Database not reachable yet (attempt ${attempt}): ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    } finally {
      await client.end({ timeout: 1 }).catch(() => undefined);
    }
  }
}

export async function runMigrations(url: string, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
