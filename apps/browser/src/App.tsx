import { useEffect } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { ChatPanel } from "./components/ChatPanel";
import { ComingSoonView } from "./components/ComingSoonView";
import { CouncilEmptyState } from "./components/CouncilEmptyState";
import { CouncilPanel } from "./components/CouncilPanel";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import { matchesBinding } from "./preferences";
import { useStore } from "./store";

export function App() {
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
    currentView,
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

  if (accounts.length === 0) {
    return <OnboardingWizard />;
  }

  const activeCouncilSession = councilSessions.find((session) => session.id === activeSessionId);

  function renderMain() {
    switch (currentView) {
      case "council":
        return activeCouncilSession ? <CouncilPanel session={activeCouncilSession} /> : <CouncilEmptyState />;
      case "projects":
        return (
          <ComingSoonView
            title="Projects"
            description="Cowork-style workspaces with a connected folder, files, and assigned agents are coming soon."
          />
        );
      case "agents":
        return (
          <ComingSoonView title="Agents" description="Create, edit, duplicate, and archive agents from here soon." />
        );
      case "settings":
        return <SettingsView />;
      case "chat":
      default:
        return <ChatPanel />;
    }
  }

  return (
    <div className="app">
      <Sidebar />
      {renderMain()}
      {accountsManagerOpen && <AccountsManager />}
      {preferencesOpen && <PreferencesPanel />}
    </div>
  );
}
