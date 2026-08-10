import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import { sql } from "drizzle-orm";
import { createDb } from "./db/client.js";
import { registerSignupRoute } from "./handlers/signup.js";
import { HttpError } from "./httpError.js";
import { assertTestModeKey } from "./stripeClient.js";
import { registerStripeWebhookRoute } from "./routes/stripeWebhook.js";
import { registerInternalStatusRoute } from "./routes/internalStatus.js";

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

app.setErrorHandler<FastifyError | HttpError>((error, _request, reply) => {
  if (error instanceof HttpError) {
    reply.code(error.status).send({ error: error.message });
    return;
  }
  if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
    reply.code(error.statusCode).send({ error: error.message });
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
registerStripeWebhookRoute(app, db);
registerInternalStatusRoute(app, db);

const port = Number(process.env.PORT ?? 3100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
