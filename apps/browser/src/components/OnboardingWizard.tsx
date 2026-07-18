import { useState } from "react";
import { useStore } from "../store";
import { capture } from "../telemetry";
import type { ProviderName } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES } from "../utils";

type Step = "welcome" | "credentials" | "done";

const PROVIDER_HINTS: Record<ProviderName, string> = {
  anthropic: "Get your key at console.anthropic.com → API Keys",
  openai: "Get your key at platform.openai.com → API keys",
  google: "Get your key at aistudio.google.com → Get API key",
  ollama: "Make sure Ollama is running locally (ollama serve)",
  openrouter: "Get your key at openrouter.ai → Keys",
};

const PROVIDER_KEY_PLACEHOLDER: Record<ProviderName, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  google: "AIza...",
  ollama: "",
  openrouter: "sk-or-...",
};

export function OnboardingWizard() {
  const { createAccount } = useStore();
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState<ProviderName>("anthropic");
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODELS.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("http://localhost:11434/v1");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  function pickProvider(p: ProviderName) {
    setProvider(p);
    setModel(PROVIDER_DEFAULT_MODELS[p]);
    setApiKey("");
  }

  async function finish() {
    setSaving(true);
    const accountLabel = label.trim() || `${PROVIDER_LABELS[provider]} account`;
    createAccount({
      label: accountLabel,
      provider,
      model: model.trim() || PROVIDER_DEFAULT_MODELS[provider],
      apiKey: provider === "ollama" ? undefined : apiKey.trim() || undefined,
      baseURL: provider === "ollama" ? baseURL.trim() || undefined : undefined,
    });
    capture({ type: "onboarding_completed", provider });
    setSaving(false);
    setStep("done");
  }

  const canFinish =
    provider === "ollama"
      ? baseURL.trim().length > 0
      : apiKey.trim().length > 0;

  if (step === "done") {
    return (
      <div className="onboarding-overlay">
        <div className="onboarding-card">
          <div className="onboarding-check">✓</div>
          <h1>You're all set!</h1>
          <p className="onboarding-sub">
            Your {PROVIDER_LABELS[provider]} account is saved. Start a new agent session from the sidebar.
          </p>
        </div>
      </div>
    );
  }

  if (step === "credentials") {
    return (
      <div className="onboarding-overlay">
        <div className="onboarding-card">
          <div className="onboarding-step-label">Step 2 of 2</div>
          <h1>Connect {PROVIDER_LABELS[provider]}</h1>
          <p className="onboarding-hint">{PROVIDER_HINTS[provider]}</p>

          <div className="onboarding-fields">
            <div className="field">
              <label htmlFor="ob-label">Account label (optional)</label>
              <input
                id="ob-label"
                placeholder={`${PROVIDER_LABELS[provider]} account`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="ob-model">Default model</label>
              <input
                id="ob-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            {provider === "ollama" ? (
              <div className="field">
                <label htmlFor="ob-baseurl">Ollama base URL</label>
                <input
                  id="ob-baseurl"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="ob-apikey">API key</label>
                <input
                  id="ob-apikey"
                  type="password"
                  placeholder={PROVIDER_KEY_PLACEHOLDER[provider]}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoFocus
                />
              </div>
            )}
          </div>

          <div className="onboarding-actions">
            <button className="settings-btn" onClick={() => setStep("welcome")}>
              ← Back
            </button>
            <button
              className="primary-btn"
              onClick={finish}
              disabled={!canFinish || saving}
            >
              {saving ? "Saving…" : "Save & start"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-step-label">Step 1 of 2</div>
        <h1>Welcome to Open Work</h1>
        <p className="onboarding-sub">
          Pick your first AI provider to get started. You can add more accounts later.
        </p>

        <div className="onboarding-providers">
          {PROVIDER_NAMES.map((p) => (
            <button
              key={p}
              className={`onboarding-provider-btn${provider === p ? " selected" : ""}`}
              onClick={() => pickProvider(p)}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>

        <div className="onboarding-actions">
          <button
            className="primary-btn"
            onClick={() => setStep("credentials")}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
