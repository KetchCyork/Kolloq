import { useEffect, useState } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { ChatPanel } from "./components/ChatPanel";
import { CouncilPanel } from "./components/CouncilPanel";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { SignInScreen } from "./components/SignInScreen";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import { loadOpenWorkSession, signOutOpenWork, type OpenWorkSession } from "./openWorkAccount";
import { matchesBinding } from "./preferences";
import { useStore } from "./store";

export function App() {
  // Open Work account gate (spec §8.1) — separate from the LLM provider connections below.
  const [openWorkSession, setOpenWorkSession] = useState<OpenWorkSession | null>(() => loadOpenWorkSession());

  const {
    ready,
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

  if (!openWorkSession) {
    return <SignInScreen onSignedIn={setOpenWorkSession} />;
  }

  if (!ready) {
    return <div className="no-session">Loading sessions…</div>;
  }

  if (accounts.length === 0) {
    return <OnboardingWizard />;
  }

  const activeCouncilSession = councilSessions.find((session) => session.id === activeSessionId);

  function signOutOfOpenWork() {
    signOutOpenWork();
    setOpenWorkSession(null);
  }

  return (
    <div className="app">
      <Sidebar />
      {activeCouncilSession ? <CouncilPanel session={activeCouncilSession} /> : <ChatPanel />}
      {accountsManagerOpen && <AccountsManager />}
      {preferencesOpen && (
        <PreferencesPanel accountEmail={openWorkSession.email} onSignOut={signOutOfOpenWork} />
      )}
    </div>
  );
}
