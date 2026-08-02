import { PRICE_PLAN } from "../config";
import { getCustomerRecord, putCustomerRecord } from "../kv";
import { retrieveCustomer } from "../stripeClient";
import { HttpError } from "../types";
import type { Env } from "../types";
import { verifyStripeSignature } from "../webhookSignature";

interface StripeSubscriptionObject {
  customer: string;
  status: string;
  current_period_end: number;
  ended_at: number | null;
  items: { data: Array<{ price: { id: string } }> };
}

interface StripeCheckoutSessionObject {
  customer: string | null;
  customer_details: { email: string | null } | null;
  customer_email: string | null;
}

interface StripeEvent {
  type: string;
  data: { object: unknown };
}

async function resolveEmailForCustomer(env: Env, customerId: string): Promise<string | null> {
  const existing = await getCustomerRecord(env, customerId);
  if (existing?.email) return existing.email;
  const customer = await retrieveCustomer(env, customerId);
  return customer.email ? customer.email.toLowerCase() : null;
}

async function handleCheckoutCompleted(env: Env, session: StripeCheckoutSessionObject): Promise<void> {
  const email = session.customer_details?.email?.toLowerCase() ?? session.customer_email?.toLowerCase() ?? null;
  if (!session.customer || !email) return;
  const existing = await getCustomerRecord(env, session.customer);
  await putCustomerRecord(env, session.customer, existing ?? { email, plan: "free", status: "active", currentPeriodEnd: null });
}

async function handleSubscriptionUpsert(env: Env, sub: StripeSubscriptionObject): Promise<void> {
  const email = await resolveEmailForCustomer(env, sub.customer);
  if (!email) return; // No known account to attach this subscription to; nothing to update.
  const priceId = sub.items.data[0]?.price?.id;
  const plan = (priceId && PRICE_PLAN[priceId]) || "free";
  await putCustomerRecord(env, sub.customer, {
    email,
    plan,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
  });
}

async function handleSubscriptionDeleted(env: Env, sub: StripeSubscriptionObject): Promise<void> {
  const email = await resolveEmailForCustomer(env, sub.customer);
  if (!email) return;
  await putCustomerRecord(env, sub.customer, {
    email,
    plan: "free",
    status: "canceled",
    currentPeriodEnd: sub.ended_at ?? sub.current_period_end,
  });
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const valid = await verifyStripeSignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) throw new HttpError(400, "invalid_signature");

  const event = JSON.parse(rawBody) as StripeEvent;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(env, event.data.object as StripeCheckoutSessionObject);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(env, event.data.object as StripeSubscriptionObject);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(env, event.data.object as StripeSubscriptionObject);
      break;
    default:
      break; // Unhandled event types are acknowledged and ignored.
  }

  return Response.json({ received: true });
}
