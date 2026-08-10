import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncSubscriptionByStripeId = vi.fn().mockResolvedValue(true);
vi.mock("../db/subscriptions.js", () => ({
  syncSubscriptionByStripeId: (...args: unknown[]) => syncSubscriptionByStripeId(...args),
}));

const { registerStripeWebhookRoute } = await import("./stripeWebhook.js");

const SECRET = "whsec_test_secret";

function buildApp() {
  const app = Fastify();
  registerStripeWebhookRoute(app, {} as never);
  return app;
}

function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${hex}`;
}

async function post(app: ReturnType<typeof buildApp>, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    payload: body,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature ?? sign(body),
    },
  });
}

describe("registerStripeWebhookRoute", () => {
  beforeEach(() => {
    syncSubscriptionByStripeId.mockClear();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  it("rejects a request with an invalid signature", async () => {
    const app = buildApp();
    const response = await post(app, { type: "customer.subscription.updated" }, sign("{}", "wrong_secret"));
    expect(response.statusCode).toBe(400);
    expect(syncSubscriptionByStripeId).not.toHaveBeenCalled();
  });

  it("500s if the webhook secret isn't configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = buildApp();
    const response = await post(app, { type: "invoice.paid" });
    expect(response.statusCode).toBe(500);
  });

  it("customer.subscription.updated syncs status and current_period_end", async () => {
    const app = buildApp();
    const response = await post(app, {
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "active", current_period_end: 1_900_000_000 } },
    });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).toHaveBeenCalledWith(expect.anything(), "sub_1", {
      status: "active",
      currentPeriodEnd: new Date(1_900_000_000 * 1000),
    });
  });

  it("customer.subscription.deleted downgrades to canceled", async () => {
    const app = buildApp();
    const response = await post(app, {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_2", status: "canceled", current_period_end: 1_900_000_000 } },
    });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).toHaveBeenCalledWith(expect.anything(), "sub_2", {
      status: "canceled",
      currentPeriodEnd: new Date(1_900_000_000 * 1000),
    });
  });

  it("invoice.paid marks the subscription active and syncs the period end from the invoice lines", async () => {
    const app = buildApp();
    const response = await post(app, {
      type: "invoice.paid",
      data: { object: { subscription: "sub_3", period_end: null, lines: { data: [{ period: { end: 1_900_111_111 } }] } } },
    });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).toHaveBeenCalledWith(expect.anything(), "sub_3", {
      status: "active",
      currentPeriodEnd: new Date(1_900_111_111 * 1000),
    });
  });

  it("invoice.paid resolves the subscription id from the 2025-API nested parent shape", async () => {
    const app = buildApp();
    const response = await post(app, {
      type: "invoice.paid",
      data: {
        object: {
          subscription: null,
          parent: { subscription_details: { subscription: "sub_new_schema" } },
          period_end: 1_900_222_222,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).toHaveBeenCalledWith(expect.anything(), "sub_new_schema", {
      status: "active",
      currentPeriodEnd: new Date(1_900_222_222 * 1000),
    });
  });

  it("invoice.payment_failed marks the subscription past_due without touching current_period_end", async () => {
    const app = buildApp();
    const response = await post(app, {
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_4", period_end: null } },
    });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).toHaveBeenCalledWith(expect.anything(), "sub_4", { status: "past_due" });
  });

  it("ignores invoice events with no subscription (one-off invoices)", async () => {
    const app = buildApp();
    const response = await post(app, { type: "invoice.paid", data: { object: { subscription: null, period_end: null } } });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores unhandled event types", async () => {
    const app = buildApp();
    const response = await post(app, { type: "customer.created", data: { object: {} } });
    expect(response.statusCode).toBe(200);
    expect(syncSubscriptionByStripeId).not.toHaveBeenCalled();
  });
});
