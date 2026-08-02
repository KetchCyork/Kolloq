import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BillingApiError,
  checkoutReturnUrl,
  createCheckoutSession,
  createPortalSession,
  fetchEntitlement,
  normalizeApiBase,
} from "./billingClient";

const BASE = "https://worker.example.com";

describe("normalizeApiBase", () => {
  it("strips a trailing slash", () => {
    expect(normalizeApiBase("https://worker.example.com/")).toBe("https://worker.example.com");
  });

  it("trims whitespace and leaves an already-clean URL alone", () => {
    expect(normalizeApiBase("  https://worker.example.com  ")).toBe("https://worker.example.com");
  });

  it("passes an empty string through (unconfigured)", () => {
    expect(normalizeApiBase("")).toBe("");
  });
});

describe("checkoutReturnUrl", () => {
  it("builds a status-tagged return URL against the given base", () => {
    expect(checkoutReturnUrl(BASE, "success")).toBe(`${BASE}/checkout/return?status=success`);
    expect(checkoutReturnUrl(BASE, "cancelled")).toBe(`${BASE}/checkout/return?status=cancelled`);
    expect(checkoutReturnUrl(BASE, "portal")).toBe(`${BASE}/checkout/return?status=portal`);
  });
});

describe("billing API calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createCheckoutSession posts the price id and return URLs, bearer-authorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://checkout.stripe.com/x", id: "cs_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession(BASE, "id-token-123", "price_pro_monthly");

    expect(result).toEqual({ url: "https://checkout.stripe.com/x", id: "cs_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/create-checkout-session`);
    expect(init.headers.Authorization).toBe("Bearer id-token-123");
    expect(JSON.parse(init.body)).toEqual({
      priceId: "price_pro_monthly",
      successUrl: `${BASE}/checkout/return?status=success`,
      cancelUrl: `${BASE}/checkout/return?status=cancelled`,
    });
  });

  it("createPortalSession posts the portal return URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://billing.stripe.com/x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPortalSession(BASE, "id-token-123");

    expect(result).toEqual({ url: "https://billing.stripe.com/x" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ returnUrl: `${BASE}/checkout/return?status=portal` });
  });

  it("fetchEntitlement GETs with the bearer token", async () => {
    const payload = { token: "jwt", plan: "pro", status: "active", currentPeriodEnd: 123, expiresAt: 456 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEntitlement(BASE, "id-token-123");

    expect(result).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/entitlement`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer id-token-123");
  });

  it("throws BillingApiError with the server's error code on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "no_billing_account" }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEntitlement(BASE, "id-token-123")).rejects.toMatchObject(new BillingApiError("no_billing_account", 404));
  });
});
