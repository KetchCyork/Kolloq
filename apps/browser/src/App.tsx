import { useEffect } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { ChatPanel } from "./components/ChatPanel";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import { matchesBinding } from "./preferences";
import { useStore } from "./store";

export function App() {
  const { ready, accounts, createSession, accountsManagerOpen, preferences, preferencesOpen, openPreferences, closePreferences } =
    useStore();

  useEffect(() => {
    const teardown = setupDesktopIntegration({ onNewSession: () => createSession() });
    return () => {
      void teardown.then((unsubscribe) => unsubscribe());
    };
  }, [createSession]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A keybinding recorder in PreferencesPanel is capturing the next keypress — don't also fire shortcuts.
      if (document.querySelector(".keybind-btn.recording")) return;
      const { keybindings } = preferences;
      if (matchesBinding(event, keybindings.newAgent)) {
        event.preventDefault();
        createSession();
      } else if (matchesBinding(event, keybindings.togglePreferences)) {
        event.preventDefault();
        preferencesOpen ? closePreferences() : openPreferences();
      } else if (matchesBinding(event, keybindings.focusComposer)) {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences, preferencesOpen, createSession, openPreferences, closePreferences]);

  if (!ready) {
    return <div className="no-session">Loading sessions…</div>;
  }

  if (accounts.length === 0) {
    return <OnboardingWizard />;
  }

  return (
    <div className="app">
      <Sidebar />
      <ChatPanel />
      {accountsManagerOpen && <AccountsManager />}
      {preferencesOpen && <PreferencesPanel />}
    </div>
  );
}
