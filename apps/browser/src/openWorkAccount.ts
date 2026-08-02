/**
 * Kolloq account gate (product spec §8.1) — the account that plans/entitlements attach to.
 * This is intentionally separate from the LLM provider connections managed in `store.tsx`/`types.ts`
 * (an `Account` there is a provider credential, not a Kolloq login). Conversations and files
 * stay local regardless of sign-in state; this only gates what the app is allowed to do.
 *
 * The session lives only in React state for the lifetime of the running app — it is never written
 * to or read from disk. Every launch must show the sign-in screen (board directive, NEW-132); do
 * not reintroduce a persisted/auto-restored session without that decision being revisited.
 *
 * There is no backend yet, so sign-in is stubbed: `signInWithPassword` mints a session locally.
 * Swap its body for a real network call once a backend exists — the `AppSession` shape is the
 * seam, so nothing else in the app (the gate in `App.tsx`) needs to change.
 */

export type SignInMethod = "password" | "google" | "apple" | "sso";

export interface AppSession {
  email: string;
  method: SignInMethod;
  signedInAt: number;
}

// Google "Continue with Google" is a real OpenID Connect sign-in — see openWorkGoogleAuth.ts.
// Apple and company-SSO have no real path without a Kolloq backend, so the UI disables those
// buttons rather than minting a fake session (the previous stub here did the latter, which is what
// made "Continue with Google" drop straight into the app without verifying anything).

/** Stub sign-in for the email/password form. Replace with a real API call later. */
export function signInWithPassword(email: string): AppSession {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Enter your email address.");
  return { email: trimmed, method: "password", signedInAt: Date.now() };
}
