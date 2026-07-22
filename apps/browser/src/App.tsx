import { useEffect } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { ChatPanel } from "./components/ChatPanel";
import { CouncilPanel } from "./components/CouncilPanel";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import { matchesBinding } from "./preferences";
import { useStore } from "./store";

export function App() {
  const {
    ready,
    initError,
    retryInit,
    resetLocalData,
    accounts,
    createSession,
    councilSessions,
    activeSessionId,
    accountsManagerOpen,
    preferences,
    preferencesOpen,
    openPreferences,
    closePreferences,
  } = useStore();

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

  if (initError) {
    return (
      <div className="no-session init-error">
        <p>Couldn't load your local sessions.</p>
        <p className="init-error-detail">{initError}</p>
        <div className="init-error-actions">
          <button type="button" onClick={retryInit}>
            Retry
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("This deletes all local sessions and accounts stored on this device. Continue?")) {
                void resetLocalData();
              }
            }}
          >
            Reset local data and reload
          </button>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return <OnboardingWizard />;
  }

  const activeCouncilSession = councilSessions.find((session) => session.id === activeSessionId);

  return (
    <div className="app">
      <Sidebar />
      {activeCouncilSession ? <CouncilPanel session={activeCouncilSession} /> : <ChatPanel />}
      {accountsManagerOpen && <AccountsManager />}
      {preferencesOpen && <PreferencesPanel />}
    </div>
  );
}
