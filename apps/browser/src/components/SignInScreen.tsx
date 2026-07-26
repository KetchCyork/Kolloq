import { useState } from "react";
import { signInWithPassword, type AppSession } from "../openWorkAccount";
import { beginGoogleSignIn, googleSignInAvailable, googleUnavailableReason, runGoogleSignIn } from "../openWorkGoogleAuth";

/**
 * Extracts a human-readable reason from whatever `continueWithGoogle` caught. Our own JS throws
 * `Error`s (`err.message`), but a failing Tauri command rejects with the raw string the Rust side
 * returned. Surfacing that string is what turns an opaque "Google sign-in failed." into an
 * actionable message like "…denied or cancelled (access_denied)." or a loopback bind error.
 */
export function googleSignInErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "Google sign-in failed.";
}

const TIERS = [
  { name: "Free", detail: "2 agents · 1 project", detail2: "1 council/mo" },
  { name: "Pro", detail: "10 agents · 10 projects", detail2: "25 councils/mo" },
  { name: "Max", detail: "Unlimited", detail2: "everything" },
];

export function SignInScreen({ onSignedIn }: { onSignedIn: (session: AppSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const googleReady = googleSignInAvailable();

  async function continueWithGoogle() {
    setError(null);
    setBusy(true);
    try {
      const session = await beginGoogleSignIn();
      const signedIn = await runGoogleSignIn(session);
      onSignedIn(signedIn);
    } catch (err) {
      // The desktop shell's Rust commands (google_oauth_capture, oauth_token_request) reject with a
      // plain string, not an Error — e.g. "Google sign-in was denied or cancelled (access_denied)."
      // or "Could not start loopback listener on port 8765: …". `err instanceof Error` is false for
      // those, so collapsing them to a generic message threw away the one line that names the cause.
      setError(googleSignInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onSignedIn(signInWithPassword(email));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    }
  }

  return (
    <div className="signin-overlay">
      <div className="signin-card">
        <div className="signin-logo">
          <img src="/logo-mark.svg" alt="" width={52} height={52} />
        </div>
        <h1>Open Work</h1>
        <div className="signin-tag">Every model. One workspace. Better decisions.</div>

        <button
          type="button"
          className="sso-btn"
          onClick={continueWithGoogle}
          disabled={!googleReady || busy}
          title={googleReady ? undefined : googleUnavailableReason() ?? undefined}
        >
          {busy ? "Waiting for Google…" : "Continue with Google"}
        </button>
        {!googleReady && <div className="signin-note signin-note-inline">{googleUnavailableReason()}</div>}
        <button type="button" className="sso-btn" disabled title="Coming soon">
          Continue with Apple
        </button>
        <button type="button" className="sso-btn" disabled title="Coming soon">
          🏢 Continue with company SSO
        </button>

        <div className="signin-or">or</div>

        <form onSubmit={submitPassword}>
          <div className="field signin-field">
            <label htmlFor="signin-email">Email address</label>
            <input
              id="signin-email"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field signin-field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="signin-error">{error}</div>}
          <button type="submit" className="primary-btn signin-submit" disabled={busy}>
            Sign in
          </button>
        </form>

        <div className="signin-note">Your chats and files stay on this device. Your account controls your plan and features.</div>
      </div>

      <div className="signin-tier-strip">
        {TIERS.map((tier) => (
          <div key={tier.name} className="signin-tier">
            <b>{tier.name}</b>
            {tier.detail}
            <br />
            {tier.detail2}
          </div>
        ))}
      </div>
    </div>
  );
}
