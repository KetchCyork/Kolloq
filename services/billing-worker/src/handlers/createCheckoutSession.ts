import { PRICE_PLAN } from "../config";
import { requireGoogleUser } from "../googleAuth";
import { getCustomerIdForEmail, putCustomerRecord } from "../kv";
import { createCheckoutSession, createCustomer } from "../stripeClient";
import { HttpError } from "../types";
import type { Env } from "../types";

export async function handleCreateCheckoutSession(request: Request, env: Env): Promise<Response> {
  const email = await requireGoogleUser(request, env);

  const body = (await request.json().catch(() => null)) as { priceId?: string; successUrl?: string; cancelUrl?: string } | null;
  const priceId = body?.priceId;
  if (!priceId || !(priceId in PRICE_PLAN)) {
    throw new HttpError(400, "unknown_price_id");
  }

  let customerId = await getCustomerIdForEmail(env, email);
  if (!customerId) {
    const customer = await createCustomer(env, email);
    customerId = customer.id;
    // Seed the entitlement record now so /entitlement resolves the mapping even before any
    // webhook has arrived; the webhook (subscription.created) fills in plan/status/period.
    await putCustomerRecord(env, customerId, { email, plan: "free", status: "active", currentPeriodEnd: null });
  }

  const session = await createCheckoutSession(env, {
    customerId,
    priceId,
    email,
    successUrl: body?.successUrl || env.DEFAULT_CHECKOUT_SUCCESS_URL,
    cancelUrl: body?.cancelUrl || env.DEFAULT_CHECKOUT_CANCEL_URL,
  });

  return Response.json({ url: session.url, id: session.id });
}
