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

export function PreferencesPanel() {
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
