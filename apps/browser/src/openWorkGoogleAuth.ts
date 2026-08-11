/**
 * Real "Continue with Google" sign-in for the Kolloq account gate.
 *
 * This replaces the previous stub (openWorkAccount.signInWithOAuth) that minted a fake local
 * session without ever contacting Google. Google Sign-In is OpenID Connect on top of OAuth 2.0
 * with PKCE:
 *
 *   1. `beginGoogleSignIn` mints a PKCE verifier/challenge, a `state`, and a `nonce`, and builds
 *      Google's real authorize URL (accounts.google.com consent screen).
 *   2. The Rust desktop shell binds a loopback listener on 127.0.0.1:<GOOGLE_LOOPBACK_PORT> and the
 *      user is sent to the authorize URL in their system browser to actually log in.
 *   3. Google redirects back to the loopback with an authorization `code` + `state`, which Rust
 *      captures and hands back.
 *   4. `completeGoogleSignIn` exchanges the code for tokens through the desktop shell's
 *      `oauth_token_request` command (Google's token endpoint, like Anthropic's, isn't callable
 *      from a browser tab — no CORS headers), then reads the verified email out of the returned
 *      OIDC id_token.
 *
 * Requirements / limits:
 *   - Needs a Google OAuth **Client ID** (baked in below — a Client ID is public by design, it is
 *     visible in the authorize URL in every user's browser) and a matching **Client Secret**.
 *   - The Client Secret is NOT baked in and must be supplied via the
 *     `VITE_GOOGLE_OAUTH_CLIENT_SECRET` build env var. Until it is set, `googleSignInConfigured()`
 *     is false and the UI must NOT offer a Google button that silently fakes a login.
 *   - Google requires `client_secret` on the token exchange even for Desktop-app clients using
 *     PKCE. Verified against the live endpoint: omitting it returns
 *     `{"error":"invalid_request","error_description":"client_secret is missing."}`. Google's own
 *     docs describe this value as not-really-secret for installed apps (it ships inside the
 *     binary), but it is still kept out of source control here.
 *   - NEW-376: confirmed this client is Google's "Desktop app" (installed/native) OAuth client
 *     type, not "Web application" — a Web-application client's redirect URI must match a
 *     console-registered value exactly, but Google accepts *any* port on this flow's
 *     `http://127.0.0.1` redirect (see `GOOGLE_REDIRECT_URI` below), which is loopback-IP behavior
 *     Google documents as exclusive to Desktop-app clients (RFC 8252). The flow working in
 *     production against the live endpoint is itself proof of the client type, independent of
 *     reading the Cloud Console. Only `.github/workflows/desktop-release.yml` (the Tauri installed-
 *     app build) consumes `VITE_GOOGLE_OAUTH_CLIENT_SECRET` — there is no separate browser-web
 *     deploy workflow that would inline it into a publicly-served bundle beyond the installed-app
 *     population Google already treats this secret as non-confidential to.
 *   - Only works in the Tauri desktop shell: the loopback capture and the CORS-free token exchange
 *     both live in Rust. In a plain browser build `googleSignInAvailable()` is false.
 *   - The id_token is read (not cryptographically re-verified) because it is received directly from
 *     Google's token endpoint over TLS in exchange for a PKCE-proofed code — per Google's guidance a
 *     token obtained that way does not require local signature verification. We still check
 *     issuer/audience/nonce/expiry/email_verified.
 */
import { isTauriRuntime } from "./credentials";
import type { AppSession } from "./openWorkAccount";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Fixed loopback port the Rust listener binds and Google redirects back to. Google ignores the
 * port when matching a `http://127.0.0.1` redirect, so registering the loopback host is enough. */
export const GOOGLE_LOOPBACK_PORT = 8765;
const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_LOOPBACK_PORT}`;
const GOOGLE_SCOPES = ["openid", "email", "profile"];

/**
 * Kolloq's Google OAuth Client ID. Safe to commit: a Client ID is a public identifier that Google
 * echoes in the authorize URL of every sign-in, and it is useless without the paired secret.
 */
const DEFAULT_GOOGLE_CLIENT_ID = "582168889348-saprf1jsc5qpengcsjshvvlpnmsiodn9.apps.googleusercontent.com";

function env(name: string): string {
  const value = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return (value ?? "").trim();
}

/** The Google OAuth Client ID. Overridable per-build so a fork can point at its own Google project. */
export function googleClientId(): string {
  return env("VITE_GOOGLE_OAUTH_CLIENT_ID") || DEFAULT_GOOGLE_CLIENT_ID;
}

/**
 * The Google OAuth Client Secret, injected at build time. Never committed. Empty means the token
 * exchange cannot complete, so sign-in must stay disabled.
 */
export function googleClientSecret(): string {
  return env("VITE_GOOGLE_OAUTH_CLIENT_SECRET");
}

/**
 * Pure predicate over the two credential halves. Split out from the env reads because Vite inlines
 * `import.meta.env` at transform time, so the env cannot be stubbed in a test — testing the rule
 * through this function keeps the suite green whether or not the machine has a real `.env`.
 */
export function credentialsComplete(clientId: string, clientSecret: string): boolean {
  return clientId.trim().length > 0 && clientSecret.trim().length > 0;
}

/** True once both halves of the Google OAuth credential are present. */
export function googleSignInConfigured(): boolean {
  return credentialsComplete(googleClientId(), googleClientSecret());
}

/**
 * True once Google sign-in can actually run end to end: it needs both a configured Client ID and
 * the Tauri desktop shell (loopback capture + CORS-free token exchange live in Rust).
 */
export function googleSignInAvailable(): boolean {
  return googleSignInConfigured() && isTauriRuntime();
}

/** Human-readable reason Google sign-in is unavailable, or null if it is available. */
export function googleUnavailableReason(): string | null {
  if (!isTauriRuntime()) return "Google sign-in is only available in the Kolloq desktop app.";
  if (!googleClientId()) return "Google sign-in isn't configured yet (missing OAuth Client ID).";
  if (!googleClientSecret()) return "Google sign-in isn't configured yet (missing OAuth Client Secret).";
  return null;
}

export interface GoogleAuthSession {
  authorizeUrl: string;
  verifier: string;
  state: string;
  nonce: string;
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

/** Builds Google's authorize URL for the PKCE + OIDC flow. Exported for testing. */
export function buildGoogleAuthorizeUrl(opts: {
  clientId: string;
  challenge: string;
  state: string;
  nonce: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: GOOGLE_SCOPES.join(" "),
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    state: opts.state,
    nonce: opts.nonce,
    access_type: "offline",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

/** Starts a Google sign-in: mints PKCE/state/nonce and builds the real authorize URL. */
export async function beginGoogleSignIn(): Promise<GoogleAuthSession> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google sign-in isn't configured yet (missing OAuth Client ID).");
  // Fail before sending the user to Google rather than after they have already logged in: without
  // the secret the token exchange is guaranteed to be rejected.
  if (!googleClientSecret()) throw new Error("Google sign-in isn't configured yet (missing OAuth Client Secret).");
  const verifier = randomToken();
  const challenge = await challengeFromVerifier(verifier);
  const state = randomToken();
  const nonce = randomToken();
  const authorizeUrl = buildGoogleAuthorizeUrl({ clientId, challenge, state, nonce });
  return { authorizeUrl, verifier, state, nonce };
}

/** Decodes the payload of a JWT (id_token) without verifying its signature. Exported for testing. */
export function decodeIdToken(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token.");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const json = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const decoded = decodeURIComponent(
    Array.from(json)
      .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join(""),
  );
  return JSON.parse(decoded) as Record<string, unknown>;
}

/**
 * Validates an already-decoded id_token payload against the expected client id and nonce and
 * returns the verified email. Exported for testing. Throws if any check fails.
 */
export function verifiedEmailFromClaims(claims: Record<string, unknown>, expected: { clientId: string; nonce: string }): string {
  const iss = String(claims.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    throw new Error("id_token issuer is not Google.");
  }
  if (String(claims.aud ?? "") !== expected.clientId) throw new Error("id_token audience does not match this app.");
  if (String(claims.nonce ?? "") !== expected.nonce) throw new Error("id_token nonce mismatch — sign-in may have been tampered with.");
  const exp = Number(claims.exp ?? 0);
  if (!exp || Date.now() / 1000 >= exp) throw new Error("id_token has expired.");
  const email = typeof claims.email === "string" ? claims.email : "";
  if (!email) throw new Error("Google did not return an email address.");
  if (claims.email_verified === false) throw new Error("This Google account's email is not verified.");
  return email;
}

interface GoogleTokenPayload {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Turns a failed token response into something actionable. Google's `error_description` names the
 * exact misconfiguration ("client_secret is missing.", "The provided client secret is invalid.",
 * "redirect_uri_mismatch"), which a bare status code hides. Exported for testing.
 */
export function googleTokenErrorMessage(status: number, payload: GoogleTokenPayload): string {
  const detail = payload.error_description || payload.error;
  if (detail) return `Google sign-in failed: ${detail}`;
  if (status >= 200 && status < 300) return "Google sign-in failed: no id_token was returned.";
  return `Google token request failed (${status}).`;
}

/**
 * Runs the full loopback capture + token exchange and returns an AppSession carrying the
 * user's real, Google-verified email. Only valid under the desktop shell (see
 * `googleSignInAvailable`).
 */
export async function runGoogleSignIn(session: GoogleAuthSession): Promise<AppSession> {
  if (!isTauriRuntime()) throw new Error("Google sign-in is only available in the Kolloq desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");

  // Bind the loopback listener first (the command awaits the redirect), then open the consent page.
  const capture = invoke<{ code: string; state: string }>("google_oauth_capture", { port: GOOGLE_LOOPBACK_PORT });
  const { openExternalUrl } = await import("./credentials");
  await openExternalUrl(session.authorizeUrl);
  const captured = await capture;

  if (captured.state !== session.state) throw new Error("OAuth state mismatch — sign-in was interrupted or tampered with.");

  const res = await invoke<{ status: number; body: string }>("oauth_token_request", {
    tokenUrl: GOOGLE_TOKEN_URL,
    body: {
      grant_type: "authorization_code",
      code: captured.code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: GOOGLE_REDIRECT_URI,
      code_verifier: session.verifier,
    },
  });
  let payload: GoogleTokenPayload;
  try {
    payload = res.body ? (JSON.parse(res.body) as GoogleTokenPayload) : {};
  } catch {
    throw new Error(`Google token request failed (${res.status}).`);
  }
  if (res.status < 200 || res.status >= 300 || !payload.id_token) {
    throw new Error(googleTokenErrorMessage(res.status, payload));
  }
  const email = verifiedEmailFromClaims(decodeIdToken(payload.id_token), {
    clientId: googleClientId(),
    nonce: session.nonce,
  });
  const appSession: AppSession = { email, method: "google", signedInAt: Date.now(), idToken: payload.id_token };
  return appSession;
}
