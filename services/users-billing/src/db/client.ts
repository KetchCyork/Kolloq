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
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
