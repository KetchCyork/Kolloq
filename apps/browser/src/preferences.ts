import type { ProviderName } from "./types";
import { PROVIDER_DEFAULT_MODELS } from "./utils";

export type ThemePreference = "dark" | "light" | "system";

export type KeybindAction = "newAgent" | "togglePreferences" | "focusComposer";

/** A key combo: `mod` means Cmd on macOS / Ctrl elsewhere, resolved at match time. */
export interface KeyBinding {
  key: string;
  mod: boolean;
  shift: boolean;
}

export interface Preferences {
  theme: ThemePreference;
  defaultProvider: ProviderName;
  defaultModel: string;
  keybindings: Record<KeybindAction, KeyBinding>;
  telemetryEnabled: boolean;
}

export const KEYBIND_ACTION_LABELS: Record<KeybindAction, string> = {
  newAgent: "New agent",
  togglePreferences: "Open preferences",
  focusComposer: "Focus message box",
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  defaultProvider: "ollama",
  defaultModel: PROVIDER_DEFAULT_MODELS.ollama,
  keybindings: {
    newAgent: { key: "n", mod: true, shift: false },
    togglePreferences: { key: ",", mod: true, shift: false },
    focusComposer: { key: "/", mod: true, shift: false },
  },
  telemetryEnabled: false,
};

const STORAGE_KEY = "newvector-cowork-preferences";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent ?? "");

export function loadPreferences(): Preferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: parsed.theme ?? DEFAULT_PREFERENCES.theme,
      defaultProvider: parsed.defaultProvider ?? DEFAULT_PREFERENCES.defaultProvider,
      defaultModel: parsed.defaultModel ?? DEFAULT_PREFERENCES.defaultModel,
      keybindings: { ...DEFAULT_PREFERENCES.keybindings, ...parsed.keybindings },
      telemetryEnabled: parsed.telemetryEnabled ?? DEFAULT_PREFERENCES.telemetryEnabled,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** Applies the resolved theme (following the OS when set to "system") as `data-theme` on <html>. */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  const resolved =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  parts.push(key);
  return parts.join(isMac ? "" : "+");
}

/** Reads a KeyboardEvent's modifiers/key into a KeyBinding, ignoring bare modifier keypresses. */
export function keyBindingFromEvent(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): KeyBinding | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) return null;
  return { key: event.key.toLowerCase(), mod: event.metaKey || event.ctrlKey, shift: event.shiftKey };
}

export function matchesBinding(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, binding: KeyBinding): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return event.key.toLowerCase() === binding.key.toLowerCase() && mod === binding.mod && event.shiftKey === binding.shift;
}
