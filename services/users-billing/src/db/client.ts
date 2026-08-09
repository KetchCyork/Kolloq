import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }
  return url;
}

export function createDb(connectionString: string = requireDatabaseUrl()) {
  // Without a timeout, an unreachable/misconfigured DB host hangs the pool's
  // connect attempt forever instead of rejecting — health checks then time out
  // silently with no error ever reaching the logger.
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
  pool.on("error", (err) => {
    console.error("Unexpected error on idle Postgres client", err);
  });
  return { db: drizzle(pool, { schema }), pool };
}
