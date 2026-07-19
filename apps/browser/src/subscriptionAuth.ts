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
 * NOTE: the Anthropic OAuth parameters below are its published Claude subscription flow and still
 * need live end-to-end verification against a real account (see NEW-67). The token exchange is a
 * cross-origin POST — it succeeds from the Tauri desktop build; in the plain browser build it may be
 * blocked by CORS, which is why subscription capture is primarily a desktop capability.
 */
import { openExternalUrl } from "./credentials";
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
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state: returnedState ?? session.state,
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      code_verifier: session.verifier,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}). ${detail}`.trim());
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new Error("Provider response did not include an access token.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scope: json.scope,
  };
}
