import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { createDb } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";
import { PRICE_PLAN } from "../config.js";
import { HttpError } from "../httpError.js";
import * as stripeClient from "../stripeClient.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupBody {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  paymentMethodId?: unknown;
  priceId?: unknown;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  paymentMethodId: string;
  priceId: string;
}

export function validateSignupBody(body: unknown): SignupInput {
  const { firstName, lastName, email, paymentMethodId, priceId } = (body ?? {}) as SignupBody;
  if (typeof firstName !== "string" || !firstName.trim()) {
    throw new HttpError(400, "first_name_required");
  }
  if (typeof lastName !== "string" || !lastName.trim()) {
    throw new HttpError(400, "last_name_required");
  }
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!EMAIL_RE.test(trimmedEmail)) {
    throw new HttpError(400, "valid_email_required");
  }
  // The card itself never reaches this backend — the client collects it via Stripe.js /
  // Payment Element and hands us only the resulting PaymentMethod reference.
  if (typeof paymentMethodId !== "string" || !paymentMethodId.startsWith("pm_")) {
    throw new HttpError(400, "payment_method_id_required");
  }
  if (typeof priceId !== "string" || !(priceId in PRICE_PLAN)) {
    throw new HttpError(400, "unknown_price_id");
  }
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: trimmedEmail.toLowerCase(),
    paymentMethodId,
    priceId,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export interface SignupDeps {
  db: ReturnType<typeof createDb>["db"];
  stripeSecretKey: string;
}

export function registerSignupRoute(app: FastifyInstance, deps: SignupDeps): void {
  app.post("/signup", async (request, reply) => {
    const input = validateSignupBody(request.body);
    const plan = PRICE_PLAN[input.priceId];

    const [existing] = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) {
      throw new HttpError(409, "email_already_registered");
    }

    const customer = await stripeClient.createCustomer(deps.stripeSecretKey, {
      email: input.email,
      name: `${input.firstName} ${input.lastName}`,
    });
    await stripeClient.attachPaymentMethod(deps.stripeSecretKey, input.paymentMethodId, customer.id);
    await stripeClient.setDefaultPaymentMethod(deps.stripeSecretKey, customer.id, input.paymentMethodId);
    const subscription = await stripeClient.createSubscription(deps.stripeSecretKey, {
      customerId: customer.id,
      priceId: input.priceId,
      paymentMethodId: input.paymentMethodId,
    });

    try {
      const { user, sub } = await deps.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ firstName: input.firstName, lastName: input.lastName, email: input.email })
          .returning();

        const [sub] = await tx
          .insert(subscriptions)
          .values({
            userId: user.id,
            plan,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
            stripeCustomerId: customer.id,
            stripeSubscriptionId: subscription.id,
            stripePriceId: input.priceId,
            defaultPaymentMethodId: input.paymentMethodId,
          })
          .returning();

        return { user, sub };
      });

      reply.code(201);
      return {
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
        subscription: {
          id: sub.id,
          plan: sub.plan,
          status: sub.status,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          stripePriceId: sub.stripePriceId,
        },
      };
    } catch (err) {
      // The pre-check above already rejects the common duplicate-signup case before any
      // Stripe call. This only fires on the rare race where two signups for the same email
      // land concurrently — cancel the TEST-mode subscription that just lost the race so it
      // doesn't linger unlinked to any user row. Best-effort: failure here doesn't change the
      // response, it's a test-mode cleanup, not a financial correction.
      await stripeClient.cancelSubscription(deps.stripeSecretKey, subscription.id).catch(() => {});
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "email_already_registered");
      }
      throw err;
    }
  });
}
