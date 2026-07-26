import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomer } from "./stripeClient";
import type { Env } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stripeClient TEST-mode guard", () => {
  it("refuses to call Stripe with a live-mode secret key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const env = { STRIPE_SECRET_KEY: "sk_live_should_never_be_used" } as Env;

    await expect(createCustomer(env, "user@example.com")).rejects.toMatchObject({ status: 500 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a TEST-mode restricted key (rk_test_)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "cus_1", email: "user@example.com" }), { status: 200 })),
    );
    const env = { STRIPE_SECRET_KEY: "rk_test_abc" } as Env;

    await expect(createCustomer(env, "user@example.com")).resolves.toEqual({ id: "cus_1", email: "user@example.com" });
  });
});
