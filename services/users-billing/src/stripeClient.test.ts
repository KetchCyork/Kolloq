import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPaymentMethod, createCustomer, createSubscription, setDefaultPaymentMethod } from "./stripeClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("stripeClient TEST-mode guard", () => {
  it("refuses to call Stripe with a live-mode secret key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createCustomer("sk_live_should_never_be_used", { email: "a@example.com", name: "A" })).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a TEST-mode restricted key (rk_test_)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "cus_1", email: "a@example.com" })));

    await expect(createCustomer("rk_test_abc", { email: "a@example.com", name: "A" })).resolves.toEqual({
      id: "cus_1",
      email: "a@example.com",
    });
  });
});

describe("stripeClient request shape", () => {
  it("attaches a payment method to a customer via the /attach endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ id: "pm_1", customer: "cus_1" }));
    vi.stubGlobal("fetch", fetchSpy);

    await attachPaymentMethod("sk_test_abc", "pm_1", "cus_1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/payment_methods/pm_1/attach");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("customer=cus_1");
  });

  it("sets the customer's default payment method via nested invoice_settings", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ id: "cus_1", email: "a@example.com" }));
    vi.stubGlobal("fetch", fetchSpy);

    await setDefaultPaymentMethod("sk_test_abc", "cus_1", "pm_1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/customers/cus_1");
    expect(init.body).toBe("invoice_settings%5Bdefault_payment_method%5D=pm_1");
  });

  it("creates a subscription with the price and default payment method", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ id: "sub_1", status: "active", current_period_end: 1700000000 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await createSubscription("sk_test_abc", {
      customerId: "cus_1",
      priceId: "price_1",
      paymentMethodId: "pm_1",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/subscriptions");
    const body = new URLSearchParams(init.body);
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("items[0][price]")).toBe("price_1");
    expect(body.get("default_payment_method")).toBe("pm_1");
    expect(result).toEqual({ id: "sub_1", status: "active", current_period_end: 1700000000 });
  });

  it("surfaces a Stripe error message with a 400 status for a bad request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "No such price" } }, 400)),
    );

    await expect(
      createSubscription("sk_test_abc", { customerId: "cus_1", priceId: "price_bad", paymentMethodId: "pm_1" }),
    ).rejects.toMatchObject({ status: 400, message: "No such price" });
  });
});
