/**
 * Open Work account gate (product spec §8.1) — the account that plans/entitlements attach to.
 * This is intentionally separate from the LLM provider connections managed in `store.tsx`/`types.ts`
 * (an `Account` there is a provider credential, not an Open Work login). Conversations and files
 * stay local regardless of sign-in state; this only gates what the app is allowed to do.
 *
 * There is no backend yet, so sign-in is stubbed: every method below mints a session locally and
 * persists it to `localStorage`. Swap the bodies of `signInWithPassword`/`signInWithOAuth` for real
 * network calls once a backend exists — the signatures and `OpenWorkSession` shape are the seam, so
 * nothing else in the app (the gate in `App.tsx`, the sign-out in `PreferencesPanel`) needs to change.
 */

const SESSION_KEY = "openwork.account.session.v1";

export type SignInMethod = "password" | "google" | "apple" | "sso";

export interface OpenWorkSession {
  email: string;
  method: SignInMethod;
  signedInAt: number;
}

function isValidSession(value: unknown): value is OpenWorkSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpenWorkSession>;
  return typeof candidate.email === "string" && typeof candidate.method === "string" && typeof candidate.signedInAt === "number";
}

export function loadOpenWorkSession(): OpenWorkSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists a session to local storage. Used by the email/password form and the real Google flow
 * (see openWorkGoogleAuth.ts), which produces its session from a Google-verified id_token. */
export function persistOpenWorkSession(session: OpenWorkSession): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function signOutOpenWork(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

// Google "Continue with Google" is a real OpenID Connect sign-in — see openWorkGoogleAuth.ts.
// Apple and company-SSO have no real path without an Open Work backend, so the UI disables those
// buttons rather than minting a fake session (the previous stub here did the latter, which is what
// made "Continue with Google" drop straight into the app without verifying anything).

/** Stub sign-in for the email/password form. Replace with a real API call later. */
export function signInWithPassword(email: string): OpenWorkSession {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Enter your email address.");
  const session: OpenWorkSession = { email: trimmed, method: "password", signedInAt: Date.now() };
  persistOpenWorkSession(session);
  return session;
}
