import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client.js";
import { HttpError } from "../httpError.js";
import { registerSignupRoute, validateSignupBody } from "./signup.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PRICE_ID = "price_1TxWR3GgrGbDWiCh6h4mm1mX"; // Pro monthly — see ../config.ts

describe("validateSignupBody", () => {
  const valid = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    paymentMethodId: "pm_123",
    priceId: PRICE_ID,
  };

  it("accepts a well-formed body and trims/lowercases the email", () => {
    expect(validateSignupBody({ ...valid, email: " Ada@Example.com " })).toEqual({
      ...valid,
      email: "ada@example.com",
    });
  });

  it("accepts Stripe's underscore-containing test-mode magic payment method tokens", () => {
    expect(validateSignupBody({ ...valid, paymentMethodId: "pm_card_visa" })).toEqual({
      ...valid,
      paymentMethodId: "pm_card_visa",
    });
  });

  it.each([
    ["missing first name", { ...valid, firstName: "" }, "first_name_required"],
    ["missing last name", { ...valid, lastName: undefined }, "last_name_required"],
    ["invalid email", { ...valid, email: "not-an-email" }, "valid_email_required"],
    ["missing payment method", { ...valid, paymentMethodId: "" }, "payment_method_id_required"],
    ["payment method not pm_-prefixed", { ...valid, paymentMethodId: "tok_123" }, "payment_method_id_required"],
    [
      "payment method with path-traversal characters",
      { ...valid, paymentMethodId: "pm_x/../../customers/cus_X" },
      "payment_method_id_required",
    ],
    ["unknown price id", { ...valid, priceId: "price_does_not_exist" }, "unknown_price_id"],
  ])("rejects %s", (_label, body, expectedMessage) => {
    let caught: unknown;
    try {
      validateSignupBody(body);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(400);
    expect((caught as HttpError).message).toBe(expectedMessage);
  });
});

function stubStripeSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/customers") && !url.includes("/payment_methods")) {
        return new Response(JSON.stringify({ id: `cus_${randomUUID()}`, email: "a@example.com" }), { status: 200 });
      }
      if (url.includes("/attach")) {
        return new Response(JSON.stringify({ id: "pm_1", customer: "cus_1" }), { status: 200 });
      }
      if (url.includes("/subscriptions")) {
        return new Response(
          JSON.stringify({ id: `sub_${randomUUID()}`, status: "active", current_period_end: 1700000000 }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected Stripe call: ${url}`);
    }),
  );
}

describe.skipIf(!DATABASE_URL)("POST /signup", () => {
  let ctx: ReturnType<typeof createDb>;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = createDb(DATABASE_URL);
    await migrate(ctx.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    app = Fastify();
    registerSignupRoute(app, { db: ctx.db, stripeSecretKey: "sk_test_fixture" });
    app.setErrorHandler<FastifyError | HttpError>((error, _request, reply) => {
      if (error instanceof HttpError) {
        reply.code(error.status).send({ error: error.message });
        return;
      }
      if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
        reply.code(error.statusCode).send({ error: error.message });
        return;
      }
      reply.code(500).send({ error: "internal_error" });
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.pool.end();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the user and subscription rows on success", async () => {
    stubStripeSuccess();
    const email = `ada-${randomUUID()}@example.com`;

    const response = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { firstName: "Ada", lastName: "Lovelace", email, paymentMethodId: "pm_123", priceId: PRICE_ID },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe(email);
    expect(body.subscription.plan).toBe("pro");
    expect(body.subscription.stripeCustomerId).toMatch(/^cus_/);
    expect(body.subscription.stripeSubscriptionId).toMatch(/^sub_/);
  });

  it("rejects a second signup for the same email with 409, before calling Stripe", async () => {
    const fetchSpy = vi.fn();
    const email = `dup-${randomUUID()}@example.com`;

    stubStripeSuccess();
    await app.inject({
      method: "POST",
      url: "/signup",
      payload: { firstName: "A", lastName: "B", email, paymentMethodId: "pm_123", priceId: PRICE_ID },
    });
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { firstName: "A", lastName: "B", email, paymentMethodId: "pm_123", priceId: PRICE_ID },
    });

    expect(response.statusCode).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body without calling Stripe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { firstName: "", lastName: "B", email: "a@example.com", paymentMethodId: "pm_1", priceId: PRICE_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 (not 500) for malformed JSON without calling Stripe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await app.inject({
      method: "POST",
      url: "/signup",
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });

    expect(response.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
