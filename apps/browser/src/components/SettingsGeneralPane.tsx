import { useState } from "react";
import { BUILD_INFO, formatBuildLabel } from "../buildInfo";
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

const BUILD_TIME_LABEL = (() => {
  const parsed = new Date(BUILD_INFO.time);
  return Number.isNaN(parsed.getTime()) ? BUILD_INFO.time : parsed.toLocaleString();
})();

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "dark", label: "🌙 Dark", hint: "Default" },
  { value: "light", label: "☀️ Light", hint: "Bright surfaces, navy text" },
  { value: "system", label: "💻 Match system", hint: "Follows OS appearance" },
];

const KEYBIND_ACTIONS = Object.keys(KEYBIND_ACTION_LABELS) as KeybindAction[];

export function SettingsGeneralPane() {
  const { preferences, updatePreferences } = useStore();
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
    <div className="settings-pane-inner">
      <h3>General</h3>

      <div className="settings-card">
        <h3>Appearance</h3>
        <div className="settings-card-sub">Choose how Open Work looks. "Match system" follows your OS setting.</div>
        <div className="settings-theme-row">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-theme-opt${preferences.theme === opt.value ? " active" : ""}`}
              onClick={() => updatePreferences({ theme: opt.value })}
            >
              <b>{opt.label}</b>
              {opt.hint}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h3>Defaults</h3>
        <div className="settings-panel">
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
      </div>

      <div className="settings-card">
        <h3>Privacy</h3>
        <div className="settings-panel">
          <div className="field span-full telemetry-row">
            <div className="telemetry-text">
              <span className="telemetry-label">Usage telemetry</span>
              <span className="telemetry-hint">
                Send anonymous usage events (session counts, provider usage, errors). No prompts, messages, or API
                keys are ever included. Off by default.
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
      </div>

      <div className="settings-card">
        <h3>Keyboard shortcuts</h3>
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

      <div className="settings-card">
        <h3>About</h3>
        <div className="settings-card-sub">
          What this install was built from — check this before assuming a change didn't ship.
        </div>
        <div className="settings-panel">
          <div className="field">
            <label>Build</label>
            <div className="settings-static-value">{formatBuildLabel(BUILD_INFO)}</div>
          </div>
          <div className="field">
            <label>Built</label>
            <div className="settings-static-value">{BUILD_TIME_LABEL}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
