import "dotenv/config";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { createDb } from "./db/client.js";

const { db } = createDb();
const app = Fastify({ logger: true });

app.get("/health", async () => {
  await db.execute(sql`select 1`);
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 3100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
