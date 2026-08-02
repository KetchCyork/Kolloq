import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

async function main() {
  const { db, pool } = createDb();
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
