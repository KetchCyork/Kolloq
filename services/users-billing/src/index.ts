import "dotenv/config";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { createDb } from "./db/client.js";
import { registerSignupRoute } from "./handlers/signup.js";
import { HttpError } from "./httpError.js";
import { assertTestModeKey } from "./stripeClient.js";

function requireStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set — see .env.example");
  }
  assertTestModeKey(key);
  return key;
}

const { db } = createDb();
const stripeSecretKey = requireStripeSecretKey();
const app = Fastify({ logger: true });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof HttpError) {
    reply.code(error.status).send({ error: error.message });
    return;
  }
  app.log.error(error);
  reply.code(500).send({ error: "internal_error" });
});

app.get("/health", async () => {
  await db.execute(sql`select 1`);
  return { status: "ok" };
});

registerSignupRoute(app, { db, stripeSecretKey });

const port = Number(process.env.PORT ?? 3100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
