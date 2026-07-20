import { useState } from "react";
import {
  formatKeyBinding,
  keyBindingFromEvent,
  KEYBIND_ACTION_LABELS,
  type KeybindAction,
  type KeyBinding,
  type ThemePreference,
} from "../preferences";
import { useStore } from "../store";
import type { ProviderName } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES } from "../utils";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match system" },
];

const KEYBIND_ACTIONS = Object.keys(KEYBIND_ACTION_LABELS) as KeybindAction[];

export function PreferencesPanel({
  accountEmail,
  onSignOut,
}: {
  accountEmail?: string;
  onSignOut?: () => void;
}) {
  const { preferences, updatePreferences, closePreferences } = useStore();
  const [recording, setRecording] = useState<KeybindAction | null>(null);

  function recordBinding(action: KeybindAction, event: React.KeyboardEvent) {
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(null);
      return;
    }
    const binding = keyBindingFromEvent(event);
    if (!binding) return;
    updatePreferences({ keybindings: { ...preferences.keybindings, [action]: binding } as Record<KeybindAction, KeyBinding> });
    setRecording(null);
  }

  return (
    <div className="modal-overlay" onClick={closePreferences}>
      <div className="modal preferences-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Preferences</h2>
          <button className="icon-btn" onClick={closePreferences} title="Close">
            ×
          </button>
        </div>

        <div className="settings-panel">
          <div className="field">
            <label htmlFor="pref-theme">Theme</label>
            <select
              id="pref-theme"
              value={preferences.theme}
              onChange={(e) => updatePreferences({ theme: e.target.value as ThemePreference })}
            >
              {THEME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pref-provider">Default provider</label>
            <select
              id="pref-provider"
              value={preferences.defaultProvider}
              onChange={(e) => {
                const provider = e.target.value as ProviderName;
                updatePreferences({ defaultProvider: provider, defaultModel: PROVIDER_DEFAULT_MODELS[provider] });
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
            <label htmlFor="pref-model">Default model</label>
            <input
              id="pref-model"
              value={preferences.defaultModel}
              onChange={(e) => updatePreferences({ defaultModel: e.target.value })}
            />
          </div>
        </div>

        {onSignOut && (
          <>
            <div className="settings-section-label">Account</div>
            <div className="settings-panel">
              <div className="field span-full telemetry-row">
                <div className="telemetry-text">
                  <span className="telemetry-label">{accountEmail}</span>
                  <span className="telemetry-hint">Signed in to Open Work. Your chats and files stay on this device.</span>
                </div>
                <button type="button" className="settings-btn" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}

        <div className="settings-section-label">Privacy</div>
        <div className="settings-panel">
          <div className="field span-full telemetry-row">
            <div className="telemetry-text">
              <span className="telemetry-label">Usage telemetry</span>
              <span className="telemetry-hint">
                Send anonymous usage events (session counts, provider usage, errors). No prompts, messages,
                or API keys are ever included. Off by default.
              </span>
            </div>
            <label className="toggle-switch" aria-label="Enable usage telemetry">
              <input
                type="checkbox"
                checked={preferences.telemetryEnabled}
                onChange={(e) => updatePreferences({ telemetryEnabled: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="settings-section-label">Keyboard shortcuts</div>
        <div className="settings-panel keybindings-list">
          {KEYBIND_ACTIONS.map((action) => (
            <div className="field span-full keybind-row" key={action}>
              <label>{KEYBIND_ACTION_LABELS[action]}</label>
              <button
                type="button"
                className={`settings-btn keybind-btn${recording === action ? " recording" : ""}`}
                onClick={() => setRecording(action)}
                onKeyDown={(e) => (recording === action ? recordBinding(action, e) : undefined)}
                onBlur={() => setRecording((current) => (current === action ? null : current))}
              >
                {recording === action ? "Press a key…" : formatKeyBinding(preferences.keybindings[action])}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
