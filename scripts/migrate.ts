/** Apply database migrations. Run in CI/CD before deploying (npm run db:migrate). */
import path from "node:path";

async function main() {
  const folder = path.join(process.cwd(), "drizzle");
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  } else {
    const { createPgliteDb } = await import("../src/db/client");
    await createPgliteDb(path.join(process.cwd(), ".pglite")); // migrates on open
  }
  console.log("Migrations applied");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
