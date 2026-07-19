import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// subscriptionAuth's runtime gate (`isTauriRuntime`) lives in ./credentials, which normally
// detects the Tauri webview via `window.__TAURI_INTERNALS__`. These tests run under Vitest's
// "node" environment (no `window`), so the real check would always report "not Tauri" — mock it
// directly to exercise both the desktop and plain-browser code paths.
let inTauriRuntime = false;
vi.mock("./credentials", () => ({
  isTauriRuntime: () => inTauriRuntime,
  openExternalUrl: vi.fn(),
}));

import {
  isOAuthCredentialExpiring,
  providerSupportsSubscription,
  refreshSubscriptionAuth,
  subscriptionSignInAvailable,
} from "./subscriptionAuth";

function enterTauriRuntime() {
  inTauriRuntime = true;
}

function exitTauriRuntime() {
  inTauriRuntime = false;
}

describe("providerSupportsSubscription", () => {
  it("is true for anthropic, false for a provider with no subscription-OAuth path", () => {
    expect(providerSupportsSubscription("anthropic")).toBe(true);
    expect(providerSupportsSubscription("openai")).toBe(false);
  });
});

describe("subscriptionSignInAvailable", () => {
  afterEach(exitTauriRuntime);

  it("is false in the plain browser build even for a provider with an OAuth flow (CORS blocks the token exchange)", () => {
    exitTauriRuntime();
    expect(subscriptionSignInAvailable("anthropic")).toBe(false);
  });

  it("is true for anthropic inside the Tauri desktop shell", () => {
    enterTauriRuntime();
    expect(subscriptionSignInAvailable("anthropic")).toBe(true);
  });

  it("stays false for a provider with no OAuth path even inside Tauri", () => {
    enterTauriRuntime();
    expect(subscriptionSignInAvailable("openai")).toBe(false);
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
  afterEach(() => {
    exitTauriRuntime();
    invokeMock.mockReset();
  });

  it("rejects with a clear message outside the Tauri desktop shell, without calling out to the network", async () => {
    exitTauriRuntime();
    await expect(refreshSubscriptionAuth("anthropic", "old-refresh")).rejects.toThrow(/desktop app/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("exchanges a refresh token for a new access token via the Tauri oauth_token_request command", async () => {
    enterTauriRuntime();
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    });

    const before = Date.now();
    const oauth = await refreshSubscriptionAuth("anthropic", "old-refresh");
    expect(oauth.accessToken).toBe("new-access");
    expect(oauth.refreshToken).toBe("new-refresh");
    expect(oauth.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(invokeMock).toHaveBeenCalledWith(
      "oauth_token_request",
      expect.objectContaining({ tokenUrl: "https://console.anthropic.com/v1/oauth/token" }),
    );
  });

  it("reuses the prior refresh token when the provider omits one on renewal", async () => {
    enterTauriRuntime();
    invokeMock.mockResolvedValue({ status: 200, body: JSON.stringify({ access_token: "new-access" }) });

    const oauth = await refreshSubscriptionAuth("anthropic", "old-refresh");
    expect(oauth.refreshToken).toBe("old-refresh");
  });

  it("throws when the provider rejects the refresh", async () => {
    enterTauriRuntime();
    invokeMock.mockResolvedValue({ status: 401, body: "invalid_grant" });

    await expect(refreshSubscriptionAuth("anthropic", "revoked")).rejects.toThrow(/401/);
  });

  it("rejects a provider with no subscription-OAuth path", async () => {
    enterTauriRuntime();
    await expect(refreshSubscriptionAuth("openai", "x")).rejects.toThrow(/does not support/);
  });
});
