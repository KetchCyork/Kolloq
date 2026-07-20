import { useState } from "react";
import { signInWithOAuth, signInWithPassword, type OpenWorkSession } from "../openWorkAccount";

const TIERS = [
  { name: "Free", detail: "2 agents · 1 project", detail2: "1 council/mo" },
  { name: "Pro", detail: "10 agents · 10 projects", detail2: "25 councils/mo" },
  { name: "Max", detail: "Unlimited", detail2: "everything" },
];

export function SignInScreen({ onSignedIn }: { onSignedIn: (session: OpenWorkSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function oauth(method: "google" | "apple" | "sso") {
    setError(null);
    onSignedIn(signInWithOAuth(method));
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

        <button type="button" className="sso-btn" onClick={() => oauth("google")}>
          Continue with Google
        </button>
        <button type="button" className="sso-btn" onClick={() => oauth("apple")}>
          Continue with Apple
        </button>
        <button type="button" className="sso-btn" onClick={() => oauth("sso")}>
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
          <button type="submit" className="primary-btn signin-submit">
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
