import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { createDb } from "../db/client.js";
import { subscriptions } from "../db/schema.js";
import { webhookLog } from "./stripeWebhook.js";

/**
 * Temporary diagnostics for the NEW-230 deploy smoke test — confirms a webhook actually
 * reached this service and synced `status`, without needing DB or Stripe-dashboard access.
 * No auth token by design: /internal/subscriptions/:id's capability is knowing the Stripe
 * subscription id itself (high-entropy `sub_...`, only obtainable from a completed /signup
 * call); /internal/webhook-log exposes only receipt timestamps/event types, no payloads or
 * secrets. Remove both routes once the smoke test is verified — not meant to be permanent.
 */
export function registerInternalStatusRoute(app: FastifyInstance, db: ReturnType<typeof createDb>["db"]): void {
  app.get("/internal/subscriptions/:stripeSubscriptionId", async (request, reply) => {
    const { stripeSubscriptionId } = request.params as { stripeSubscriptionId: string };
    const [sub] = await db
      .select({ status: subscriptions.status, updatedAt: subscriptions.updatedAt })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);

    if (!sub) {
      return reply.code(404).send({ error: "not_found" });
    }
    return sub;
  });

  // Same temporary NEW-230 smoke-test scope as the route above — see its docstring.
  app.get("/internal/webhook-log", async () => webhookLog);
}
