import { useEffect, useState } from "react";
import type { ModelOption } from "@newvector/core";
import { listModels } from "@newvector/core";
import { getProviderFetch } from "../providerFetch";
import { useStore } from "../store";
import { capture } from "../telemetry";
import type { ProviderName } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES, reconcileModelSelection } from "../utils";

/** Debounce before firing a live model-list request after the provider/key/base URL settle. */
const MODEL_LIST_DEBOUNCE_MS = 500;

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
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  function pickProvider(p: ProviderName) {
    setProvider(p);
    setModel(PROVIDER_DEFAULT_MODELS[p]);
    setApiKey("");
    setModelOptions([]);
    setModelsError(null);
    setModelsLoading(false);
  }

  // Live model discovery: refetch whenever provider/key/base URL settle, so the "Default model"
  // dropdown always reflects what the account can actually reach instead of a free-typed guess.
  useEffect(() => {
    const canList = provider === "ollama" || provider === "openrouter" || !!apiKey.trim();
    if (!canList) {
      setModelOptions([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    const timer = setTimeout(() => {
      listModels({
        provider,
        apiKey: apiKey.trim() || undefined,
        // `baseURL` state defaults to the Ollama URL regardless of the selected provider (it's
        // only ever edited via the Ollama-specific field below), so only forward it for Ollama —
        // otherwise every other provider's list request gets misrouted to the local Ollama server.
        baseURL: provider === "ollama" ? baseURL.trim() || undefined : undefined,
        // Route the list request through the desktop Rust relay (like chat) so provider model
        // lists load on Windows WebView2, where a direct browser-origin call is CORS-blocked and
        // fails as "failed to download model list" / "Authentication failed" (NEW-316).
        fetchImpl: getProviderFetch(),
      })
        .then((models) => {
          if (cancelled) return;
          setModelOptions(models);
          setModelsLoading(false);
          // The live catalog is the source of truth for what this account can actually reach, so
          // snap the selection onto it — otherwise a hardcoded default the provider has since
          // retired stays selected and 404s on the first chat.
          setModel((current) =>
            reconcileModelSelection(current, models.map((m) => m.id), PROVIDER_DEFAULT_MODELS[provider]),
          );
        })
        .catch((err) => {
          if (cancelled) return;
          setModelOptions([]);
          setModelsError(err instanceof Error ? err.message : "Could not load models.");
          setModelsLoading(false);
        });
    }, MODEL_LIST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, apiKey, baseURL]);

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
    // Always keep the current model selectable, even if it's not (yet) in the live list —
    // e.g. while the live list is still loading, or if it failed and we fell back to the default.
    const baseModelOptions = modelOptions.length > 0 ? modelOptions : [{ id: PROVIDER_DEFAULT_MODELS[provider] }];
    const modelSelectOptions = baseModelOptions.some((opt) => opt.id === model)
      ? baseModelOptions
      : [{ id: model }, ...baseModelOptions];

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
              <select
                id="ob-model"
                value={model}
                disabled={modelsLoading}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelSelectOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label && opt.label !== opt.id ? `${opt.label} (${opt.id})` : opt.id}
                  </option>
                ))}
              </select>
              {modelsLoading && <div className="field-hint">Loading available models…</div>}
              {modelsError && !modelsLoading && (
                <div className="field-hint field-hint-error">
                  Couldn't load live models ({modelsError}). Showing the default list.
                </div>
              )}
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
        <h1>Welcome to Kolloq</h1>
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
