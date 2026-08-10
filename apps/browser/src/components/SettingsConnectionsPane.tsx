import { useEffect, useState } from "react";
import type { ModelOption } from "@newvector/core";
import { listModels } from "@newvector/core";
import { isTauriRuntime } from "../credentials";
import { confirmDialog } from "../dialogs";
import { useLimitGate } from "../entitlement";
import { DEFAULT_OLLAMA_BASE_URL, useOllamaModels } from "../ollamaDiscovery";
import { getProviderFetch } from "../providerFetch";
import { useStore } from "../store";
import type { Account, ProviderName } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES, reconcileModelSelection } from "../utils";

/** Debounce before firing a live model-list request after the provider/key settle. */
const MODEL_LIST_DEBOUNCE_MS = 500;

/**
 * API-key-only by design (board decision, 2026-07-22 — see NEW-76/NEW-69): subscription sign-in is
 * not offered here even though `subscriptionAuth.ts` still has a working OAuth flow for Anthropic on
 * this branch. Don't wire that flow into this pane.
 */
interface DraftAccount {
  label: string;
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseURL: string;
}

function blankDraft(): DraftAccount {
  return { label: "", provider: "anthropic", model: PROVIDER_DEFAULT_MODELS.anthropic, apiKey: "", baseURL: "" };
}

function draftFromAccount(account: Account): DraftAccount {
  return { label: account.label, provider: account.provider, model: account.model, apiKey: "", baseURL: account.baseURL ?? "" };
}

const PROVIDER_LOGO_COLOR: Record<ProviderName, string> = {
  anthropic: "#c96442",
  openai: "#565f6e",
  google: "#3b6ea5",
  ollama: "#565f6e",
  openrouter: "#6b6f7d",
};

function providerInitial(provider: ProviderName): string {
  return PROVIDER_LABELS[provider].slice(0, 1).toUpperCase();
}

export function SettingsConnectionsPane() {
  const { accounts, createAccount, updateAccount, deleteAccount } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftAccount>(blankDraft());
  const [saveBusy, setSaveBusy] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const ollama = useOllamaModels();
  const gate = useLimitGate();

  // Live model discovery for API-key providers (Ollama has its own discovery flow below): while the
  // add/edit form is open, refetch the provider's catalog whenever the provider or key settle so the
  // "Default model" field is a dropdown of real models instead of a free-typed guess (NEW-368). Only
  // OpenRouter can list without a key; the others need the key, so nothing loads until it's entered
  // (e.g. when editing, until the key is re-typed) — the current model stays selectable regardless.
  useEffect(() => {
    if (!adding || draft.provider === "ollama") {
      setModelOptions([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }
    const key = draft.apiKey.trim();
    const canList = draft.provider === "openrouter" || !!key;
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
        provider: draft.provider,
        apiKey: key || undefined,
        // Route through the desktop Rust relay (like chat) so model lists load on Windows WebView2,
        // where a direct browser-origin request is CORS-blocked (NEW-316).
        fetchImpl: getProviderFetch(),
      })
        .then((models) => {
          if (cancelled) return;
          setModelOptions(models);
          setModelsLoading(false);
          // Snap the selection onto the live catalog so a retired hardcoded default doesn't stay
          // selected and 404 on the first chat.
          setDraft((current) => ({
            ...current,
            model: reconcileModelSelection(
              current.model,
              models.map((m) => m.id),
              PROVIDER_DEFAULT_MODELS[current.provider],
            ),
          }));
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
    // draft.model is intentionally omitted: refetch only when the provider or key changes, not on
    // every dropdown pick (which would re-run discovery and fight the user's selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, draft.provider, draft.apiKey]);

  async function startAdd() {
    if (!(await gate("connections", accounts.length))) return;
    setDraft(blankDraft());
    setEditingId(null);
    ollama.reset();
    setAdding(true);
  }

  function startEdit(account: Account) {
    setDraft(draftFromAccount(account));
    setEditingId(account.id);
    ollama.reset();
    setAdding(true);
    if (account.provider === "ollama") {
      void ollama.check(account.baseURL ?? DEFAULT_OLLAMA_BASE_URL, account.model);
    }
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    ollama.reset();
  }

  function changeProvider(provider: ProviderName) {
    const model = provider === "ollama" ? "" : PROVIDER_DEFAULT_MODELS[provider];
    setDraft({ ...draft, provider, model });
    ollama.reset();
  }

  async function save() {
    const label = draft.label.trim() || `${PROVIDER_LABELS[draft.provider]} account`;
    const model = draft.model.trim() || (draft.provider === "ollama" ? "" : PROVIDER_DEFAULT_MODELS[draft.provider]);
    const baseURL = draft.baseURL.trim() || undefined;

    if (draft.provider === "ollama") {
      setSaveBusy(true);
      const models = await ollama.check(baseURL ?? DEFAULT_OLLAMA_BASE_URL, model);
      setSaveBusy(false);
      if (models.length === 0 || !models.includes(model)) return;
    }

    if (editingId) {
      const patch: Partial<Omit<Account, "id" | "createdAt">> = {
        label,
        provider: draft.provider,
        model,
        baseURL,
        authType: "api_key",
        oauth: undefined,
      };
      if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
      updateAccount(editingId, patch);
    } else {
      createAccount({
        label,
        provider: draft.provider,
        model,
        authType: "api_key",
        baseURL,
        apiKey: draft.apiKey.trim() || undefined,
      });
    }
    cancelForm();
  }

  async function remove(account: Account) {
    if (await confirmDialog({ message: `Delete connection "${account.label}"? Sessions using it will need a new account picked.`, confirmLabel: "Delete", danger: true })) {
      deleteAccount(account.id);
      if (editingId === account.id) cancelForm();
    }
  }

  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>LLM Connections</h3>
        <div className="spacer" />
        {!adding && (
          <button type="button" className="primary-btn" onClick={() => void startAdd()}>
            + Add connection
          </button>
        )}
      </div>

      {accounts.length === 0 && !adding && (
        <div className="empty-state">No connections yet. Add one to start picking models from the composer.</div>
      )}

      {accounts.length > 0 && (
        <div className="settings-grid">
          {accounts.map((account) => (
            <div className="settings-card" key={account.id}>
              <div className="settings-card-row">
                <div className="settings-provider-logo" style={{ background: PROVIDER_LOGO_COLOR[account.provider] }}>
                  {providerInitial(account.provider)}
                </div>
                <div>
                  <h3>{account.label}</h3>
                  <div className="settings-card-sub">
                    {PROVIDER_LABELS[account.provider]}
                    {account.provider === "ollama" && account.baseURL ? ` · ${account.baseURL}` : ` · ${account.model}`}
                  </div>
                </div>
                <span className="badge green" style={{ marginLeft: "auto" }}>
                  Connected
                </span>
              </div>
              <div className="settings-kv">
                <button type="button" className="settings-btn" onClick={() => startEdit(account)}>
                  Edit
                </button>
                <button type="button" className="settings-btn" onClick={() => remove(account)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="settings-card">
          <div className="settings-form-grid">
            <div className="field">
              <label htmlFor="conn-label">Label</label>
              <input
                id="conn-label"
                placeholder="e.g. Work OpenAI key"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="conn-provider">Provider</label>
              <select id="conn-provider" value={draft.provider} onChange={(e) => changeProvider(e.target.value as ProviderName)}>
                {PROVIDER_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {PROVIDER_LABELS[name]}
                  </option>
                ))}
              </select>
            </div>

            {draft.provider === "ollama" ? null : (
              (() => {
                // Always keep the current model selectable even if it isn't (yet) in the live list —
                // while discovery is loading, when it failed, or before a key unlocks the catalog.
                const baseOptions =
                  modelOptions.length > 0 ? modelOptions : [{ id: PROVIDER_DEFAULT_MODELS[draft.provider] }];
                const selectOptions = baseOptions.some((opt) => opt.id === draft.model)
                  ? baseOptions
                  : [{ id: draft.model }, ...baseOptions];
                const needsKey = draft.provider !== "openrouter" && !draft.apiKey.trim();
                return (
                  <div className="field">
                    <label htmlFor="conn-model">Default model</label>
                    <select
                      id="conn-model"
                      value={draft.model}
                      disabled={modelsLoading}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    >
                      {selectOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label && opt.label !== opt.id ? `${opt.label} (${opt.id})` : opt.id}
                        </option>
                      ))}
                    </select>
                    {modelsLoading && <div className="settings-note">Loading available models…</div>}
                    {!modelsLoading && needsKey && (
                      <div className="settings-note">Enter the API key to list this provider's models.</div>
                    )}
                    {modelsError && !modelsLoading && (
                      <div className="ollama-status error">
                        Couldn't load live models ({modelsError}). Showing the default.
                      </div>
                    )}
                  </div>
                );
              })()
            )}

            {draft.provider === "ollama" ? (
              <div className="field span-full">
                <label htmlFor="conn-baseurl">Ollama base URL</label>
                <input
                  id="conn-baseurl"
                  placeholder={DEFAULT_OLLAMA_BASE_URL}
                  value={draft.baseURL}
                  onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
                  onBlur={(e) => void ollama.check(e.target.value, draft.model)}
                />
                <div className="settings-note">
                  Works with a local install ({DEFAULT_OLLAMA_BASE_URL}) or a remote/hosted Ollama-compatible API.
                  {isTauriRuntime() &&
                    " Note: the desktop app can only relay to a local instance (localhost/127.0.0.1); for a remote endpoint, add this connection from the browser app instead."}
                </div>

                <div className="ollama-test-row">
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => void ollama.check(draft.baseURL, draft.model)}
                    disabled={ollama.status === "loading"}
                  >
                    {ollama.status === "loading" ? "Testing…" : "Test connection"}
                  </button>
                  {ollama.status === "loaded" && !ollama.error && (
                    <span className="ollama-status ok">
                      ✓ Connected — {ollama.models.length} model{ollama.models.length === 1 ? "" : "s"} found
                    </span>
                  )}
                </div>
                {ollama.error && <div className="ollama-status error">{ollama.error}</div>}

                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="conn-ollama-model">Model</label>
                  {ollama.models.length > 0 ? (
                    <select
                      id="conn-ollama-model"
                      value={draft.model}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraft({ ...draft, model: value });
                        void ollama.check(draft.baseURL, value);
                      }}
                    >
                      {!draft.model && (
                        <option value="" disabled>
                          Select a model…
                        </option>
                      )}
                      {ollama.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="conn-ollama-model"
                      placeholder="Test the connection to list available models"
                      value={draft.model}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="conn-apikey">API key{editingId ? " (leave blank to keep current)" : ""}</label>
                <input
                  id="conn-apikey"
                  type="password"
                  placeholder="sk-..."
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
            )}

            <div className="field span-full account-form-actions">
              <button type="button" className="settings-btn" onClick={cancelForm}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={() => void save()} disabled={saveBusy}>
                {saveBusy ? "Checking…" : editingId ? "Save connection" : "Add connection"}
              </button>
            </div>
          </div>
          <div className="settings-note">
            Kolloq validates the key with a test call, then lists the models you can use. Keys never leave this device.
          </div>
        </div>
      )}
    </div>
  );
}
