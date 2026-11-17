/**
 * Database connection.
 *
 * - With DATABASE_URL set (staging/production on Vercel + Neon Postgres) we use node-postgres.
 * - Without it (local development) we use PGlite, a real Postgres engine embedded in
 *   the process, persisted to ./.pglite. Same SQL, same migrations, no setup needed.
 */
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

// Kept on globalThis because Next.js loads route handlers and server actions in
// separate module graphs; a module-level variable would open two databases.
const g = globalThis as unknown as { __harvestlinkDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__harvestlinkDb ??= connect();
  return g.__harvestlinkDb;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    return drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  const db = await createPgliteDb(path.join(process.cwd(), ".pglite"));
  return db;
}

/** Create a PGlite database and apply migrations. `dataDir` undefined = in-memory (tests). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
