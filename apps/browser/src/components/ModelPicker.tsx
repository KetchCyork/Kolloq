import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { Account, ProviderConfig } from "../types";
import { PROVIDER_LABELS } from "../utils";

export function ModelPicker({
  providerConfig,
  onChange,
}: {
  providerConfig: ProviderConfig;
  onChange: (patch: Partial<ProviderConfig>) => void;
}) {
  const { accounts, openAccountsManager } = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedAccount = accounts.find((account) => account.id === providerConfig.accountId);
  const label = selectedAccount
    ? `${selectedAccount.label} · ${selectedAccount.model}`
    : providerConfig.accountId
      ? "Account removed — pick another"
      : `${PROVIDER_LABELS[providerConfig.provider]} · ${providerConfig.model}`;

  const grouped = new Map<string, Account[]>();
  for (const account of accounts) {
    const list = grouped.get(account.provider) ?? [];
    list.push(account);
    grouped.set(account.provider, list);
  }

  function pick(account: Account) {
    onChange({ accountId: account.id, provider: account.provider, model: account.model });
    setOpen(false);
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button type="button" className="model-picker-btn" onClick={() => setOpen((v) => !v)}>
        {label} <span className="model-picker-caret">▾</span>
      </button>

      {open && (
        <div className="model-picker-menu">
          {accounts.length === 0 && <div className="model-picker-empty">No saved accounts yet.</div>}
          {[...grouped.entries()].map(([provider, providerAccounts]) => (
            <div key={provider} className="model-picker-group">
              <div className="model-picker-group-label">{PROVIDER_LABELS[provider as Account["provider"]]}</div>
              {providerAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className={`model-picker-item${account.id === providerConfig.accountId ? " active" : ""}`}
                  onClick={() => pick(account)}
                >
                  <span>{account.label}</span>
                  <span className="model-picker-item-model">{account.model}</span>
                </button>
              ))}
            </div>
          ))}
          <button
            type="button"
            className="model-picker-manage"
            onClick={() => {
              setOpen(false);
              openAccountsManager();
            }}
          >
            Manage accounts…
          </button>
        </div>
      )}
    </div>
  );
}
