import { eq } from "drizzle-orm";
import type { createDb } from "./client.js";
import { subscriptions } from "./schema.js";

type Db = ReturnType<typeof createDb>["db"];

export interface SubscriptionSyncPatch {
  status: string;
  /** Omit to leave the stored value untouched (e.g. a failed-payment event carries no new period end). */
  currentPeriodEnd?: Date | null;
}

/**
 * Syncs status/current_period_end for the subscription row matching a Stripe subscription id.
 * Returns false (no-op) when no matching row exists yet — e.g. a webhook arriving before the
 * signup flow (NEW-228) has created the row, or a stale/foreign event.
 */
export async function syncSubscriptionByStripeId(
  db: Db,
  stripeSubscriptionId: string,
  patch: SubscriptionSyncPatch,
): Promise<boolean> {
  const set: { status: string; updatedAt: Date; currentPeriodEnd?: Date | null } = {
    status: patch.status,
    updatedAt: new Date(),
  };
  if ("currentPeriodEnd" in patch) set.currentPeriodEnd = patch.currentPeriodEnd;

  const updated = await db
    .update(subscriptions)
    .set(set)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .returning({ id: subscriptions.id });

  return updated.length > 0;
}
