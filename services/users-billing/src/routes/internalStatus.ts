import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { createDb } from "../db/client.js";
import { subscriptions } from "../db/schema.js";

/**
 * Temporary diagnostic for the NEW-230 deploy smoke test: confirms a webhook actually synced
 * `status` without needing DB or Stripe-dashboard access. No auth token by design — the
 * capability is knowing the Stripe subscription id (a high-entropy `sub_...` value returned
 * only from a completed /signup call), and the response leaks nothing beyond a status enum.
 * Remove this route once the smoke test is verified; it isn't meant to be permanent surface.
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
}
