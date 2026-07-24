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
  beginSubscriptionAuth,
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

// No provider is wired for subscription OAuth: Anthropic was withdrawn because the only working
// client id belongs to Anthropic's own Claude Code product (NEW-69). These tests pin that the
// flow stays inert everywhere rather than half-offering a sign-in that can't be honoured.
describe("providerSupportsSubscription", () => {
  it("is false for every provider while no subscription-OAuth client is registered to us", () => {
    expect(providerSupportsSubscription("anthropic")).toBe(false);
    expect(providerSupportsSubscription("openai")).toBe(false);
  });
});

describe("subscriptionSignInAvailable", () => {
  afterEach(exitTauriRuntime);

  it("is false in the plain browser build", () => {
    exitTauriRuntime();
    expect(subscriptionSignInAvailable("anthropic")).toBe(false);
  });

  it("stays false inside the Tauri desktop shell too — the desktop gate alone doesn't enable it", () => {
    enterTauriRuntime();
    expect(subscriptionSignInAvailable("anthropic")).toBe(false);
    expect(subscriptionSignInAvailable("openai")).toBe(false);
  });
});

describe("beginSubscriptionAuth", () => {
  afterEach(() => {
    exitTauriRuntime();
    invokeMock.mockReset();
  });

  it("refuses to build an authorize URL for anthropic, so no consent screen can be opened", async () => {
    enterTauriRuntime();
    await expect(beginSubscriptionAuth("anthropic")).rejects.toThrow(/does not support/);
    expect(invokeMock).not.toHaveBeenCalled();
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

  // An account saved before the provider was withdrawn still holds a refresh token; renewing it
  // must not quietly reach back out to the provider on the withdrawn client id.
  it("rejects for a provider with no subscription-OAuth path, without calling out to the network", async () => {
    enterTauriRuntime();
    await expect(refreshSubscriptionAuth("anthropic", "old-refresh")).rejects.toThrow(/does not support/);
    await expect(refreshSubscriptionAuth("openai", "x")).rejects.toThrow(/does not support/);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
