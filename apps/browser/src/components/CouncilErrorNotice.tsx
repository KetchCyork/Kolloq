import { classifyProviderError } from "@newvector/core";
import { useStore } from "../store";

/** Shared, prominent error card for a council per-member drop or moderator failure — classifies the
 * raw provider error into a human-readable reason and, when the cause looks like an account/model/
 * connectivity misconfiguration, surfaces a direct fix-it link instead of leaving the user to guess. */
export function CouncilErrorNotice({ label, error }: { label: string; error: string }) {
  const { openAccountsManager } = useStore();
  const classified = classifyProviderError(error);

  return (
    <div className="council-error-notice">
      <div className="council-error-notice-head">
        <span aria-hidden="true">⚠</span>
        <span>{label}</span>
      </div>
      <div className="council-error-notice-reason">{classified.reason}</div>
      {classified.raw !== classified.reason && <div className="council-error-notice-raw">{classified.raw}</div>}
      {classified.isConfigIssue && (
        <button type="button" className="settings-btn council-error-notice-action" onClick={openAccountsManager}>
          Manage Accounts →
        </button>
      )}
    </div>
  );
}
