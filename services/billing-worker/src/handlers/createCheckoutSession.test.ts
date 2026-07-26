import { describe, expect, it, vi } from "vitest";
import { getCustomerIdForEmail } from "../kv";
import { createInMemoryKv } from "../testFixtures";
import type { Env } from "../types";

vi.mock("../googleAuth", () => ({
  requireGoogleUser: vi.fn().mockResolvedValue("user@example.com"),
}));

const createCustomer = vi.fn().mockResolvedValue({ id: "cus_new", email: "user@example.com" });
const createCheckoutSession = vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
vi.mock("../stripeClient", () => ({
  createCustomer: (...args: unknown[]) => createCustomer(...args),
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

const { handleCreateCheckoutSession } = await import("./createCheckoutSession");

const KNOWN_PRICE_ID = "price_1TxWR3GgrGbDWiCh6h4mm1mX"; // Pro monthly, see ../config.ts

function makeEnv(): Env {
  return {
    BILLING_KV: createInMemoryKv(),
    DEFAULT_CHECKOUT_SUCCESS_URL: "https://app.example.com/success",
    DEFAULT_CHECKOUT_CANCEL_URL: "https://app.example.com/cancel",
  } as unknown as Env;
}

function postRequest(body: unknown) {
  return new Request("https://worker/create-checkout-session", { method: "POST", body: JSON.stringify(body) });
}

describe("handleCreateCheckoutSession", () => {
  it("rejects an unknown price id", async () => {
    // Handlers throw HttpError and let the top-level router (src/index.ts) map it to a Response.
    await expect(handleCreateCheckoutSession(postRequest({ priceId: "price_not_real" }), makeEnv())).rejects.toMatchObject({
      status: 400,
    });
  });

  it("creates a Stripe customer on first checkout and stores the mapping", async () => {
    const env = makeEnv();
    const response = await handleCreateCheckoutSession(postRequest({ priceId: KNOWN_PRICE_ID }), env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.url).toBe("https://checkout.stripe.com/cs_test_1");
    expect(createCustomer).toHaveBeenCalledWith(env, "user@example.com");
    expect(await getCustomerIdForEmail(env, "user@example.com")).toBe("cus_new");
    expect(createCheckoutSession).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ customerId: "cus_new", priceId: KNOWN_PRICE_ID, email: "user@example.com" }),
    );
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    const env = makeEnv();
    await env.BILLING_KV.put("email:user@example.com", "cus_existing");
    createCustomer.mockClear();

    await handleCreateCheckoutSession(postRequest({ priceId: KNOWN_PRICE_ID }), env);

    expect(createCustomer).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalledWith(env, expect.objectContaining({ customerId: "cus_existing" }));
  });
});
