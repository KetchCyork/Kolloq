import { afterEach, describe, expect, it, vi } from "vitest";
import { isOAuthCredentialExpiring, providerSupportsSubscription, refreshSubscriptionAuth } from "./subscriptionAuth";

describe("providerSupportsSubscription", () => {
  it("is true for anthropic, false for a provider with no subscription-OAuth path", () => {
    expect(providerSupportsSubscription("anthropic")).toBe(true);
    expect(providerSupportsSubscription("openai")).toBe(false);
  });
});

describe("isOAuthCredentialExpiring", () => {
  it("is false when the credential has no expiry (nothing to refresh against)", () => {
    expect(isOAuthCredentialExpiring({ accessToken: "t" })).toBe(false);
  });

  it("is false when comfortably before expiry, true once within the skew window", () => {
    const farFuture = { accessToken: "t", expiresAt: Date.now() + 60 * 60 * 1000 };
    expect(isOAuthCredentialExpiring(farFuture)).toBe(false);

    const aboutToExpire = { accessToken: "t", expiresAt: Date.now() + 1000 };
    expect(isOAuthCredentialExpiring(aboutToExpire)).toBe(true);

    const alreadyExpired = { accessToken: "t", expiresAt: Date.now() - 1000 };
    expect(isOAuthCredentialExpiring(alreadyExpired)).toBe(true);
  });
});

describe("refreshSubscriptionAuth", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exchanges a refresh token for a new access token", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    })) as unknown as typeof fetch;

    const before = Date.now();
    const oauth = await refreshSubscriptionAuth("anthropic", "old-refresh");
    expect(oauth.accessToken).toBe("new-access");
    expect(oauth.refreshToken).toBe("new-refresh");
    expect(oauth.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("reuses the prior refresh token when the provider omits one on renewal", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-access" }),
    })) as unknown as typeof fetch;

    const oauth = await refreshSubscriptionAuth("anthropic", "old-refresh");
    expect(oauth.refreshToken).toBe("old-refresh");
  });

  it("throws when the provider rejects the refresh", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid_grant",
    })) as unknown as typeof fetch;

    await expect(refreshSubscriptionAuth("anthropic", "revoked")).rejects.toThrow(/401/);
  });

  it("rejects a provider with no subscription-OAuth path", async () => {
    await expect(refreshSubscriptionAuth("openai", "x")).rejects.toThrow(/does not support/);
  });
});
