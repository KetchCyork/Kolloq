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
import { PROVIDER_NAMES } from "./utils";

function enterTauriRuntime() {
  inTauriRuntime = true;
}

function exitTauriRuntime() {
  inTauriRuntime = false;
}

// No provider ships a subscription OAuth flow (NEW-69: Anthropic's was removed rather than keep
// authenticating as Anthropic's own "Claude Code" client id). These tests pin that shut, so
// re-enabling a provider is a deliberate change with a failing test to answer for — the PKCE and
// token-exchange machinery itself is unreachable in a shipped build while the map is empty.
describe("providerSupportsSubscription", () => {
  it("is false for every provider — all accounts use an API key", () => {
    for (const provider of PROVIDER_NAMES) {
      expect(providerSupportsSubscription(provider)).toBe(false);
    }
  });
});

describe("subscriptionSignInAvailable", () => {
  afterEach(exitTauriRuntime);

  it("is false for every provider in the plain browser build", () => {
    exitTauriRuntime();
    for (const provider of PROVIDER_NAMES) {
      expect(subscriptionSignInAvailable(provider)).toBe(false);
    }
  });

  it("stays false for every provider inside the Tauri desktop shell too", () => {
    enterTauriRuntime();
    for (const provider of PROVIDER_NAMES) {
      expect(subscriptionSignInAvailable(provider)).toBe(false);
    }
  });
});

describe("beginSubscriptionAuth", () => {
  afterEach(exitTauriRuntime);

  it("refuses to build an authorize URL for any provider, so no third-party client id can be sent", async () => {
    enterTauriRuntime();
    for (const provider of PROVIDER_NAMES) {
      await expect(beginSubscriptionAuth(provider)).rejects.toThrow(/does not support/);
    }
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

  // An account saved before the flow was removed still holds a refresh token. The store swallows
  // refresh failures and falls back to the stale token, so the only thing that matters here is that
  // we reject locally instead of quietly re-contacting the provider with a client id we shouldn't use.
  it("rejects every provider without calling out to the network", async () => {
    enterTauriRuntime();
    for (const provider of PROVIDER_NAMES) {
      await expect(refreshSubscriptionAuth(provider, "old-refresh")).rejects.toThrow(/does not support/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
