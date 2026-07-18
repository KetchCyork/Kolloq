import { useState } from "react";
import { useStore } from "../store";
import type { Account, ProviderName } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES } from "../utils";

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
  return {
    label: account.label,
    provider: account.provider,
    model: account.model,
    apiKey: "",
    baseURL: account.baseURL ?? "",
  };
}

export function AccountsManager() {
  const { accounts, createAccount, updateAccount, deleteAccount, closeAccountsManager } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(accounts.length === 0);
  const [draft, setDraft] = useState<DraftAccount>(blankDraft());

  function startAdd() {
    setDraft(blankDraft());
    setEditingId(null);
    setAdding(true);
  }

  function startEdit(account: Account) {
    setDraft(draftFromAccount(account));
    setEditingId(account.id);
    setAdding(true);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
  }

  function save() {
    const label = draft.label.trim() || `${PROVIDER_LABELS[draft.provider]} account`;
    const model = draft.model.trim() || PROVIDER_DEFAULT_MODELS[draft.provider];
    const baseURL = draft.baseURL.trim() || undefined;

    if (editingId) {
      const patch: Partial<Omit<Account, "id" | "createdAt">> = { label, provider: draft.provider, model, baseURL };
      if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
      updateAccount(editingId, patch);
    } else {
      createAccount({
        label,
        provider: draft.provider,
        model,
        apiKey: draft.apiKey.trim() || undefined,
        baseURL,
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
                  {PROVIDER_LABELS[account.provider]} · {account.model}
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
                onChange={(e) => {
                  const provider = e.target.value as ProviderName;
                  setDraft({ ...draft, provider, model: PROVIDER_DEFAULT_MODELS[provider] });
                }}
              >
                {PROVIDER_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {PROVIDER_LABELS[name]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="account-model">Default model</label>
              <input
                id="account-model"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </div>

            {draft.provider === "ollama" ? (
              <div className="field">
                <label htmlFor="account-baseurl">Ollama base URL</label>
                <input
                  id="account-baseurl"
                  placeholder="http://localhost:11434/v1"
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
