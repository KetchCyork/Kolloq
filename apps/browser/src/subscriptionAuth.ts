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
 * Anthropic's token endpoint (console.anthropic.com/v1/oauth/token) does not send
 * `Access-Control-Allow-Origin` for third-party origins — it's designed to be called from a
 * CLI/native context (that's how Claude Code itself does it), not fetched directly from a browser
 * tab. Verified live: the consent screen completes but the token POST fails with a CORS error in
 * both the plain browser build and a `fetch` issued from the Tauri webview. So the exchange/refresh
 * request is routed through the desktop app's Rust layer (`oauth_token_request`, see
 * apps/desktop/src-tauri/src/oauth.rs), which isn't subject to browser CORS. There is no backend
 * server in this app to relay the request for the plain (non-Tauri) browser build, so subscription
 * sign-in there is gated off with a clear message rather than left to fail silently — see
 * `subscriptionSignInAvailable`.
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

const ANTHROPIC_OAUTH: OAuthProviderConfig = {
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
};

/**
 * Providers with a working subscription OAuth flow. OpenAI is intentionally absent: ChatGPT Plus
 * offers no supported OAuth path to drive the API, so those accounts must use an API key.
 */
const OAUTH_PROVIDERS: Partial<Record<ProviderName, OAuthProviderConfig>> = {
  anthropic: ANTHROPIC_OAUTH,
};

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
export function launchSubscriptionLogin(session: SubscriptionAuthSession): void {
  openExternalUrl(session.authorizeUrl);
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
