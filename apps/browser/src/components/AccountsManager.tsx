import { useEffect, useState } from "react";
import type { ModelOption } from "@newvector/core";
import { listModels } from "@newvector/core";
import { useStore } from "../store";
import {
  beginSubscriptionAuth,
  completeSubscriptionAuth,
  launchSubscriptionLogin,
  providerSupportsSubscription,
  subscriptionSignInAvailable,
  type SubscriptionAuthSession,
} from "../subscriptionAuth";
import type { Account, AccountAuthType, OAuthCredential, ProviderName } from "../types";
import { DEFAULT_OLLAMA_BASE_URL, PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES } from "../utils";

/** Debounce before firing a live model-list request after the account form's provider/key/base URL settle. */
const MODEL_LIST_DEBOUNCE_MS = 500;

interface DraftAccount {
  label: string;
  provider: ProviderName;
  model: string;
  authType: AccountAuthType;
  apiKey: string;
  baseURL: string;
  oauth?: OAuthCredential;
}

function blankDraft(): DraftAccount {
  return {
    label: "",
    provider: "anthropic",
    model: PROVIDER_DEFAULT_MODELS.anthropic,
    authType: "api_key",
    apiKey: "",
    baseURL: "",
  };
}

function draftFromAccount(account: Account): DraftAccount {
  return {
    label: account.label,
    provider: account.provider,
    model: account.model,
    authType: account.authType ?? "api_key",
    apiKey: "",
    baseURL: account.baseURL ?? "",
    oauth: account.oauth,
  };
}

export function AccountsManager() {
  const { accounts, createAccount, updateAccount, deleteAccount, closeAccountsManager } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(accounts.length === 0);
  const [draft, setDraft] = useState<DraftAccount>(blankDraft());
  const [authSession, setAuthSession] = useState<SubscriptionAuthSession | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  // The apiKey input is left blank when editing an existing account (so a saved secret is never
  // echoed back into the DOM); this holds that account's real key so we can still list models for
  // it until the user types a replacement.
  const [originalApiKey, setOriginalApiKey] = useState<string | undefined>(undefined);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  function resetAuthState() {
    setAuthSession(null);
    setAuthCode("");
    setAuthStatus(null);
    setAuthBusy(false);
  }

  function resetModelListState() {
    setModelOptions([]);
    setModelsError(null);
    setModelsLoading(false);
  }

  function startAdd() {
    setDraft(blankDraft());
    setEditingId(null);
    setOriginalApiKey(undefined);
    resetAuthState();
    resetModelListState();
    setAdding(true);
  }

  function startEdit(account: Account) {
    setDraft(draftFromAccount(account));
    setEditingId(account.id);
    setOriginalApiKey(account.apiKey);
    resetAuthState();
    resetModelListState();
    setAdding(true);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setOriginalApiKey(undefined);
    resetAuthState();
    resetModelListState();
  }

  function changeProvider(provider: ProviderName) {
    const authType = subscriptionSignInAvailable(provider) ? draft.authType : "api_key";
    // baseURL is only ever edited via the Ollama-specific field; clear it when switching away so
    // a leftover Ollama URL doesn't get saved against (or used to list models for) another provider.
    const baseURL = provider === "ollama" ? draft.baseURL : "";
    setDraft({ ...draft, provider, model: PROVIDER_DEFAULT_MODELS[provider], authType, baseURL });
    resetAuthState();
    resetModelListState();
  }

  function changeAuthType(authType: AccountAuthType) {
    setDraft({ ...draft, authType });
    resetAuthState();
  }

  async function startSignIn() {
    resetAuthState();
    try {
      const session = await beginSubscriptionAuth(draft.provider);
      setAuthSession(session);
      launchSubscriptionLogin(session);
      setAuthStatus("Sign in in your browser, then paste the authorization code below.");
    } catch (err) {
      setAuthStatus(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  }

  async function finishSignIn() {
    if (!authSession) return;
    setAuthBusy(true);
    setAuthStatus("Exchanging authorization code…");
    try {
      const oauth = await completeSubscriptionAuth(authSession, authCode);
      setDraft((current) => ({ ...current, oauth }));
      setAuthSession(null);
      setAuthCode("");
      setAuthStatus("Connected ✓");
    } catch (err) {
      setAuthStatus(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  // Live model discovery: refetch whenever provider/key/base URL settle, so the "Default model"
  // dropdown always reflects what the account can actually reach instead of a free-typed guess.
  useEffect(() => {
    const provider = draft.provider;
    const apiKey = draft.apiKey.trim() || originalApiKey;
    const accessToken = draft.authType === "subscription" ? draft.oauth?.accessToken : undefined;

    const canList =
      provider === "ollama" ||
      provider === "openrouter" ||
      (draft.authType === "subscription" ? !!accessToken : !!apiKey);

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
        apiKey,
        // `draft.baseURL` is only ever edited via the Ollama-specific field, but changing
        // provider doesn't clear it — forward it for Ollama only, so switching from a custom
        // Ollama URL to another provider doesn't misroute that provider's list request there.
        baseURL: provider === "ollama" ? draft.baseURL.trim() || DEFAULT_OLLAMA_BASE_URL : undefined,
        authType: draft.authType,
        accessToken,
      })
        .then((models) => {
          if (cancelled) return;
          setModelOptions(models);
          setModelsLoading(false);
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
  }, [draft.provider, draft.apiKey, draft.baseURL, draft.authType, draft.oauth, originalApiKey]);

  // A live list load must never leave a stale/hardcoded model (e.g. the initial provider default)
  // selected once real values are available — jump to the first live entry instead.
  useEffect(() => {
    if (modelOptions.length === 0) return;
    setDraft((current) => {
      if (modelOptions.some((opt) => opt.id === current.model)) return current;
      return { ...current, model: modelOptions[0].id };
    });
  }, [modelOptions]);

  function save() {
    const label = draft.label.trim() || `${PROVIDER_LABELS[draft.provider]} account`;
    const model = draft.model.trim() || PROVIDER_DEFAULT_MODELS[draft.provider];
    const baseURL = draft.provider === "ollama" ? draft.baseURL.trim() || DEFAULT_OLLAMA_BASE_URL : undefined;
    const authType = draft.authType;

    if (authType === "subscription" && !draft.oauth) {
      setAuthStatus("Sign in to the subscription before saving.");
      return;
    }

    if (editingId) {
      const patch: Partial<Omit<Account, "id" | "createdAt">> = { label, provider: draft.provider, model, baseURL, authType };
      if (authType === "subscription") {
        patch.apiKey = undefined;
        if (draft.oauth) patch.oauth = draft.oauth;
      } else {
        patch.oauth = undefined;
        if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
      }
      updateAccount(editingId, patch);
    } else {
      createAccount({
        label,
        provider: draft.provider,
        model,
        authType,
        baseURL,
        apiKey: authType === "api_key" ? draft.apiKey.trim() || undefined : undefined,
        oauth: authType === "subscription" ? draft.oauth : undefined,
      });
    }
    cancelForm();
  }

  function remove(account: Account) {
    if (window.confirm(`Delete account "${account.label}"? Sessions using it will need a new account picked.`)) {
      deleteAccount(account.id);
      if (editingId === account.id) cancelForm();
    }
  }

  const providerHasOAuth = providerSupportsSubscription(draft.provider);
  const supportsSubscription = subscriptionSignInAvailable(draft.provider);
  const subscriptionNeedsDesktop = providerHasOAuth && !supportsSubscription;
  const connected = !!draft.oauth;

  // Always keep the current draft model selectable, even if it's not (yet) in the live list —
  // e.g. a saved account whose model was retired, or while the live list is still loading.
  const baseModelOptions = modelOptions.length > 0 ? modelOptions : [{ id: PROVIDER_DEFAULT_MODELS[draft.provider] }];
  // Once a live list has loaded, only ever offer values from it — never fall back to a stale
  // hardcoded/previously-saved model that isn't actually in the provider's real catalog.
  const modelSelectOptions =
    modelOptions.length > 0 || baseModelOptions.some((opt) => opt.id === draft.model)
      ? baseModelOptions
      : [{ id: draft.model }, ...baseModelOptions];

  return (
    <div className="modal-overlay" onClick={closeAccountsManager}>
      <div className="modal accounts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage accounts</h2>
          <button className="icon-btn" onClick={closeAccountsManager} title="Close">
            ×
          </button>
        </div>

        <div className="accounts-list">
          {accounts.length === 0 && !adding && (
            <div className="empty-state" style={{ margin: "12px 0" }}>
              No accounts yet. Add one to start picking models from the composer.
            </div>
          )}
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <div className="account-row-meta">
                <div className="account-row-label">{account.label}</div>
                <div className="account-row-sub">
                  {PROVIDER_LABELS[account.provider]} · {account.authType === "subscription" ? "Subscription" : account.model}
                </div>
              </div>
              <button className="settings-btn" onClick={() => startEdit(account)}>
                Edit
              </button>
              <button className="settings-btn" onClick={() => remove(account)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="settings-panel account-form">
            <div className="field">
              <label htmlFor="account-label">Label</label>
              <input
                id="account-label"
                placeholder="e.g. Work OpenAI key"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="account-provider">Provider</label>
              <select
                id="account-provider"
                value={draft.provider}
                onChange={(e) => changeProvider(e.target.value as ProviderName)}
              >
                {PROVIDER_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {PROVIDER_LABELS[name]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field span-full">
              <label>Account type</label>
              <div className="auth-type-toggle" role="radiogroup" aria-label="Account type">
                <button
                  type="button"
                  className={`settings-btn${draft.authType === "api_key" ? " active" : ""}`}
                  aria-pressed={draft.authType === "api_key"}
                  onClick={() => changeAuthType("api_key")}
                >
                  API key
                </button>
                <button
                  type="button"
                  className={`settings-btn${draft.authType === "subscription" ? " active" : ""}`}
                  aria-pressed={draft.authType === "subscription"}
                  disabled={!supportsSubscription}
                  title={
                    supportsSubscription
                      ? undefined
                      : subscriptionNeedsDesktop
                        ? "Subscription sign-in requires the desktop app (the browser can't complete the provider's login)."
                        : "This provider has no subscription sign-in yet."
                  }
                  onClick={() => changeAuthType("subscription")}
                >
                  Subscription
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="account-model">Default model</label>
              <select
                id="account-model"
                value={draft.model}
                disabled={modelsLoading}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
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

            {draft.authType === "subscription" ? (
              <div className="field span-full subscription-panel">
                {supportsSubscription ? (
                  <>
                    <div className="subscription-status">
                      {connected ? "Connected ✓" : "Not connected"}
                    </div>
                    <button className="settings-btn" onClick={startSignIn} disabled={authBusy}>
                      {connected ? `Re-connect ${PROVIDER_LABELS[draft.provider]}` : `Sign in to ${PROVIDER_LABELS[draft.provider]}`}
                    </button>
                    {authSession && (
                      <div className="field" style={{ marginTop: 8 }}>
                        <label htmlFor="account-authcode">Authorization code</label>
                        <input
                          id="account-authcode"
                          placeholder="Paste the code from the login page"
                          value={authCode}
                          onChange={(e) => setAuthCode(e.target.value)}
                        />
                        <button
                          className="primary-btn"
                          style={{ marginTop: 8 }}
                          onClick={finishSignIn}
                          disabled={authBusy || !authCode.trim()}
                        >
                          {authBusy ? "Connecting…" : "Connect"}
                        </button>
                      </div>
                    )}
                    {authStatus && <div className="subscription-hint">{authStatus}</div>}
                  </>
                ) : (
                  <div className="subscription-hint">
                    {subscriptionNeedsDesktop
                      ? `Subscription sign-in for ${PROVIDER_LABELS[draft.provider]} requires the New Vector Cowork desktop app — the browser can't complete the provider's login. Use an API key here, or add this account from the desktop app.`
                      : `${PROVIDER_LABELS[draft.provider]} has no subscription sign-in yet — use an API key.`}
                  </div>
                )}
              </div>
            ) : draft.provider === "ollama" ? (
              <div className="field">
                <label htmlFor="account-baseurl">Ollama base URL</label>
                <input
                  id="account-baseurl"
                  placeholder={DEFAULT_OLLAMA_BASE_URL}
                  value={draft.baseURL}
                  onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="account-apikey">API key{editingId ? " (leave blank to keep current)" : ""}</label>
                <input
                  id="account-apikey"
                  type="password"
                  placeholder="sk-..."
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
            )}

            <div className="field span-full account-form-actions">
              <button className="settings-btn" onClick={cancelForm}>
                Cancel
              </button>
              <button className="primary-btn" onClick={save}>
                {editingId ? "Save account" : "Add account"}
              </button>
            </div>
          </div>
        ) : (
          <button className="primary-btn add-account-btn" onClick={startAdd}>
            + Add account
          </button>
        )}
      </div>
    </div>
  );
}
