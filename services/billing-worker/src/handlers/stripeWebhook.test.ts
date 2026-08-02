import { describe, expect, it, vi } from "vitest";
import { getCustomerRecord } from "../kv";
import { createInMemoryKv } from "../testFixtures";
import type { Env } from "../types";

const retrieveCustomer = vi.fn();
vi.mock("../stripeClient", () => ({
  retrieveCustomer: (...args: unknown[]) => retrieveCustomer(...args),
}));

const { handleStripeWebhook } = await import("./stripeWebhook");

const SECRET = "whsec_test_secret";
const KNOWN_PRICE_ID = "price_1TxWR4GgrGbDWiChDelYk2LV"; // Max monthly, see ../config.ts

async function signedRequest(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://worker/stripe-webhook", {
    method: "POST",
    body,
    headers: { "Stripe-Signature": `t=${timestamp},v1=${hex}` },
  });
}

function makeEnv(): Env {
  return { BILLING_KV: createInMemoryKv(), STRIPE_WEBHOOK_SECRET: SECRET } as unknown as Env;
}

describe("handleStripeWebhook", () => {
  it("rejects a request with an invalid signature", async () => {
    // Handlers throw HttpError and let the top-level router (src/index.ts) map it to a Response.
    const request = await signedRequest({ type: "customer.subscription.created" }, "wrong_secret");
    await expect(handleStripeWebhook(request, makeEnv())).rejects.toMatchObject({ status: 400 });
  });

  it("checkout.session.completed links the customer id to the email", async () => {
    const env = makeEnv();
    const request = await signedRequest({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_1", customer_details: { email: "User@Example.com" }, customer_email: null } },
    });

    const response = await handleStripeWebhook(request, env);
    expect(response.status).toBe(200);
    expect(await getCustomerRecord(env, "cus_1")).toEqual({
      email: "user@example.com",
      plan: "free",
      status: "active",
      currentPeriodEnd: null,
    });
  });

  it("customer.subscription.created sets the plan from the price id, using the email already on file", async () => {
    const env = makeEnv();
    await handleStripeWebhook(
      await signedRequest({
        type: "checkout.session.completed",
        data: { object: { customer: "cus_2", customer_details: { email: "user2@example.com" } } },
      }),
      env,
    );

    const request = await signedRequest({
      type: "customer.subscription.created",
      data: {
        object: { customer: "cus_2", status: "active", current_period_end: 1_900_000_000, items: { data: [{ price: { id: KNOWN_PRICE_ID } }] } },
      },
    });
    const response = await handleStripeWebhook(request, env);

    expect(response.status).toBe(200);
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(await getCustomerRecord(env, "cus_2")).toEqual({
      email: "user2@example.com",
      plan: "max",
      status: "active",
      currentPeriodEnd: 1_900_000_000,
    });
  });

  it("falls back to fetching the customer from Stripe when the email isn't known yet", async () => {
    const env = makeEnv();
    retrieveCustomer.mockResolvedValueOnce({ id: "cus_3", email: "Late@Example.com" });

    const request = await signedRequest({
      type: "customer.subscription.updated",
      data: {
        object: { customer: "cus_3", status: "active", current_period_end: 1_900_000_000, items: { data: [{ price: { id: KNOWN_PRICE_ID } }] } },
      },
    });
    await handleStripeWebhook(request, env);

    expect(retrieveCustomer).toHaveBeenCalledWith(env, "cus_3");
    expect(await getCustomerRecord(env, "cus_3")).toMatchObject({ email: "late@example.com", plan: "max" });
  });

  it("customer.subscription.deleted downgrades the stored record to free/canceled", async () => {
    const env = makeEnv();
    await handleStripeWebhook(
      await signedRequest({
        type: "checkout.session.completed",
        data: { object: { customer: "cus_4", customer_details: { email: "user4@example.com" } } },
      }),
      env,
    );

    const request = await signedRequest({
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_4", status: "canceled", current_period_end: 1_900_000_000, ended_at: 1_900_050_000, items: { data: [] } } },
    });
    await handleStripeWebhook(request, env);

    expect(await getCustomerRecord(env, "cus_4")).toEqual({
      email: "user4@example.com",
      plan: "free",
      status: "canceled",
      currentPeriodEnd: 1_900_050_000,
    });
  });

  it("acknowledges but ignores unhandled event types", async () => {
    const response = await handleStripeWebhook(await signedRequest({ type: "invoice.paid", data: { object: {} } }), makeEnv());
    expect(response.status).toBe(200);
  });
});
