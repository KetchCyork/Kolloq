/**
 * Subscription sign-in: OAuth (PKCE) capture of a provider login so an account can drive a paid
 * plan (e.g. Claude Pro/Max) instead of a metered API key. The flow is:
 *
 *   1. `beginSubscriptionAuth` builds an authorize URL with a fresh PKCE verifier/challenge.
 *   2. `openExternalUrl(session.authorizeUrl)` sends the user to the provider's login page.
 *   3. The provider redirects to an out-of-band page showing an authorization code.
 *   4. The user pastes that code back and `completeSubscriptionAuth` exchanges it for tokens.
 *
 * The out-of-band ("paste the code") variant is used so this works in both the browser and desktop
 * builds without a loopback HTTP server.
 *
 * No provider is wired up today, so subscription sign-in is inert — every account uses an API key.
 * Anthropic used to be configured here, but the only client id that works against
 * `claude.ai/oauth/authorize` is Anthropic's own registered client for *Claude Code*, so users saw
 * "Claude Code would like to connect to your Claude chat account" when connecting a New Vector
 * account. Reusing another product's registered credential is a user-trust and ToS problem, and the
 * board decided on 2026-07-22 (NEW-69) to keep Anthropic on API keys instead. Re-enabling means
 * adding an entry below for a client id actually registered to us.
 *
 * The machinery is kept because it is provider-agnostic: the token exchange/refresh is routed
 * through the desktop app's Rust layer (`oauth_token_request`, see
 * apps/desktop/src-tauri/src/oauth.rs) because provider token endpoints generally don't send
 * `Access-Control-Allow-Origin` for third-party origins, and this app has no backend to relay from
 * the plain browser build — hence the `subscriptionSignInAvailable` desktop gate.
 */
import { isTauriRuntime, openExternalUrl } from "./credentials";
import type { OAuthCredential, ProviderName } from "./types";

interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Providers with a working subscription OAuth flow, keyed by provider name. Empty by design: see
 * the module docs for why Anthropic was removed, and add an entry here only with a client id
 * registered to New Vector AI.
 */
const OAUTH_PROVIDERS: Partial<Record<ProviderName, OAuthProviderConfig>> = {};

export function providerSupportsSubscription(provider: ProviderName): boolean {
  return provider in OAUTH_PROVIDERS;
}

/**
 * True once a provider both has an OAuth flow (`providerSupportsSubscription`) *and* this runtime
 * can actually complete the token exchange. Today that means the Tauri desktop shell: the exchange
 * is CORS-blocked from a plain browser tab with no backend to relay it (see module docs).
 */
export function subscriptionSignInAvailable(provider: ProviderName): boolean {
  return providerSupportsSubscription(provider) && isTauriRuntime();
}

export interface SubscriptionAuthSession {
  provider: ProviderName;
  /** URL to open in the browser so the user can log in and authorize. */
  authorizeUrl: string;
  verifier: string;
  state: string;
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/** Starts a sign-in: mints PKCE material and builds the provider authorize URL. */
export async function beginSubscriptionAuth(provider: ProviderName): Promise<SubscriptionAuthSession> {
  const cfg = OAUTH_PROVIDERS[provider];
  if (!cfg) throw new Error(`${provider} does not support subscription sign-in.`);
  if (!isTauriRuntime()) {
    throw new Error(
      "Subscription sign-in isn't available in the browser: the provider blocks the token exchange from a web page. Use the desktop app, or add this account with an API key instead.",
    );
  }
  const verifier = randomToken();
  const challenge = await challengeFromVerifier(verifier);
  const state = randomToken();
  const params = new URLSearchParams({
    code: "true",
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return { provider, authorizeUrl: `${cfg.authorizeUrl}?${params.toString()}`, verifier, state };
}

/** Opens the provider login page in the browser. */
export async function launchSubscriptionLogin(session: SubscriptionAuthSession): Promise<void> {
  await openExternalUrl(session.authorizeUrl);
}

interface TokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * POSTs a token request. Under Tauri this is relayed through the Rust `oauth_token_request`
 * command so it isn't subject to the provider's CORS restrictions; there is no way to complete it
 * from a plain browser tab (see module docs), so callers must check `subscriptionSignInAvailable`
 * before starting a sign-in.
 */
async function postTokenRequest(tokenUrl: string, body: Record<string, unknown>): Promise<TokenPayload> {
  if (!isTauriRuntime()) {
    throw new Error(
      "Subscription sign-in isn't available in the browser: the provider blocks the token exchange from a web page. Use the desktop app, or add this account with an API key instead.",
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ status: number; body: string }>("oauth_token_request", { tokenUrl, body });
  let json: TokenPayload | { error?: string; error_description?: string };
  try {
    json = res.body ? JSON.parse(res.body) : {};
  } catch {
    throw new Error(`Token request failed (${res.status}). ${res.body}`.trim());
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = "error_description" in json && json.error_description ? json.error_description : res.body;
    throw new Error(`Token request failed (${res.status}). ${detail}`.trim());
  }
  const payload = json as TokenPayload;
  if (!payload.access_token) throw new Error("Provider response did not include an access token.");
  return payload;
}

/** Exchanges the pasted authorization code for OAuth tokens. */
export async function completeSubscriptionAuth(
  session: SubscriptionAuthSession,
  pastedCode: string,
): Promise<OAuthCredential> {
  const cfg = OAUTH_PROVIDERS[session.provider];
  if (!cfg) throw new Error(`${session.provider} does not support subscription sign-in.`);
  const trimmed = pastedCode.trim();
  if (!trimmed) throw new Error("Paste the authorization code from the login page.");
  // Anthropic's out-of-band page returns "<code>#<state>"; accept either form.
  const [code, returnedState] = trimmed.split("#");
  const json = await postTokenRequest(cfg.tokenUrl, {
    grant_type: "authorization_code",
    code,
    state: returnedState ?? session.state,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code_verifier: session.verifier,
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scope: json.scope,
  };
}

/** True once an OAuth credential is at (or close enough to) its expiry that it should be refreshed before use. */
export function isOAuthCredentialExpiring(oauth: OAuthCredential, skewMs = 60_000): boolean {
  if (!oauth.expiresAt) return false;
  return Date.now() >= oauth.expiresAt - skewMs;
}

/** Exchanges a stored refresh token for a new access token, so a subscription account keeps working past its first token's expiry. */
export async function refreshSubscriptionAuth(provider: ProviderName, refreshToken: string): Promise<OAuthCredential> {
  const cfg = OAUTH_PROVIDERS[provider];
  if (!cfg) throw new Error(`${provider} does not support subscription sign-in.`);
  const json = await postTokenRequest(cfg.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  return {
    accessToken: json.access_token,
    // Some providers omit `refresh_token` on renewal and expect the same one reused.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scope: json.scope,
  };
}
