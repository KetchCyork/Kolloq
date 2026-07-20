/**
 * Real "Continue with Google" sign-in for the Open Work account gate.
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
 *   - Needs a Google OAuth **Client ID** (Desktop-app type) supplied via the
 *     `VITE_GOOGLE_OAUTH_CLIENT_ID` build env var. Until that is set, `googleSignInConfigured()` is
 *     false and the UI must NOT offer a Google button that silently fakes a login.
 *   - Only works in the Tauri desktop shell: the loopback capture and the CORS-free token exchange
 *     both live in Rust. In a plain browser build `googleSignInAvailable()` is false.
 *   - The id_token is read (not cryptographically re-verified) because it is received directly from
 *     Google's token endpoint over TLS in exchange for a PKCE-proofed code — per Google's guidance a
 *     token obtained that way does not require local signature verification. We still check
 *     issuer/audience/nonce/expiry/email_verified.
 */
import { isTauriRuntime } from "./credentials";
import { persistOpenWorkSession, type OpenWorkSession } from "./openWorkAccount";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Fixed loopback port the Rust listener binds and Google redirects back to. Google ignores the
 * port when matching a `http://127.0.0.1` redirect, so registering the loopback host is enough. */
export const GOOGLE_LOOPBACK_PORT = 8765;
const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_LOOPBACK_PORT}`;
const GOOGLE_SCOPES = ["openid", "email", "profile"];

/** The Google OAuth Client ID, injected at build time. Empty string means "not configured yet". */
export function googleClientId(): string {
  const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_OAUTH_CLIENT_ID;
  return (fromEnv ?? "").trim();
}

/** True once a Google OAuth Client ID has been provisioned. */
export function googleSignInConfigured(): boolean {
  return googleClientId().length > 0;
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
  if (!isTauriRuntime()) return "Google sign-in is only available in the OpenWork desktop app.";
  if (!googleSignInConfigured()) return "Google sign-in isn't configured yet.";
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
}

/**
 * Runs the full loopback capture + token exchange and returns an OpenWorkSession carrying the
 * user's real, Google-verified email. Only valid under the desktop shell (see
 * `googleSignInAvailable`).
 */
export async function runGoogleSignIn(session: GoogleAuthSession): Promise<OpenWorkSession> {
  if (!isTauriRuntime()) throw new Error("Google sign-in is only available in the OpenWork desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");

  // Bind the loopback listener first (the command awaits the redirect), then open the consent page.
  const capture = invoke<{ code: string; state: string }>("google_oauth_capture", { port: GOOGLE_LOOPBACK_PORT });
  const { openExternalUrl } = await import("./credentials");
  openExternalUrl(session.authorizeUrl);
  const captured = await capture;

  if (captured.state !== session.state) throw new Error("OAuth state mismatch — sign-in was interrupted or tampered with.");

  const res = await invoke<{ status: number; body: string }>("oauth_token_request", {
    tokenUrl: GOOGLE_TOKEN_URL,
    body: {
      grant_type: "authorization_code",
      code: captured.code,
      client_id: googleClientId(),
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
    throw new Error(`Google token request failed (${res.status}).`);
  }
  const email = verifiedEmailFromClaims(decodeIdToken(payload.id_token), {
    clientId: googleClientId(),
    nonce: session.nonce,
  });
  const openWorkSession: OpenWorkSession = { email, method: "google", signedInAt: Date.now() };
  persistOpenWorkSession(openWorkSession);
  return openWorkSession;
}
