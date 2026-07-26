import { useEffect, useState } from "react";
import { AgentsView } from "./components/AgentsView";
import { ChatPanel } from "./components/ChatPanel";
import { ComingSoonView } from "./components/ComingSoonView";
import { CouncilEmptyState } from "./components/CouncilEmptyState";
import { CouncilPanel } from "./components/CouncilPanel";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { ProjectPanel } from "./components/ProjectPanel";
import { ProjectsEmptyState } from "./components/ProjectsEmptyState";
import { SettingsView } from "./components/SettingsView";
import { SignInScreen } from "./components/SignInScreen";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import type { AppSession } from "./openWorkAccount";
import { matchesBinding } from "./preferences";
import { useStore } from "./store";

export function App() {
  // Open Work account gate (spec §8.1) — separate from the LLM provider connections in `store.tsx`.
  // Session lives in memory only: every launch must show the sign-in screen (board directive, NEW-132).
  const [appSession, setAppSession] = useState<AppSession | null>(null);

  const {
    ready,
    accounts,
    createSession,
    councilSessions,
    projects,
    activeSessionId,
    preferences,
    currentView,
    setCurrentView,
    setSettingsTab,
  } = useStore();

  useEffect(() => {
    const teardown = setupDesktopIntegration({ onNewSession: () => createSession() });
    return () => {
      void teardown.then((unsubscribe) => unsubscribe());
    };
  }, [createSession]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A keybinding recorder in SettingsGeneralPane is capturing the next keypress — don't also fire shortcuts.
      if (document.querySelector(".keybind-btn.recording")) return;
      const { keybindings } = preferences;
      if (matchesBinding(event, keybindings.newAgent)) {
        event.preventDefault();
        createSession();
      } else if (matchesBinding(event, keybindings.togglePreferences)) {
        event.preventDefault();
        if (currentView === "settings") {
          setCurrentView("chat");
        } else {
          setSettingsTab("general");
          setCurrentView("settings");
        }
      } else if (matchesBinding(event, keybindings.focusComposer)) {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences, currentView, createSession, setCurrentView, setSettingsTab]);

  if (!appSession) {
    return <SignInScreen onSignedIn={setAppSession} />;
  }

  if (!ready) {
    return <div className="no-session">Loading sessions…</div>;
  }

  if (accounts.length === 0) {
    return <OnboardingWizard />;
  }

  const activeCouncilSession = councilSessions.find((session) => session.id === activeSessionId);
  const activeProject = projects.find((project) => project.id === activeSessionId);
  const accountEmail = appSession.email;

  function handleSignOut() {
    setAppSession(null);
  }

  function renderMain() {
    switch (currentView) {
      case "council":
        return activeCouncilSession ? <CouncilPanel session={activeCouncilSession} /> : <CouncilEmptyState />;
      case "projects":
        return activeProject ? <ProjectPanel project={activeProject} /> : <ProjectsEmptyState />;
      case "agents":
        return <AgentsView />;
      case "settings":
        return <SettingsView accountEmail={accountEmail} onSignOut={handleSignOut} />;
      case "chat":
      default:
        return <ChatPanel />;
    }
  }

  return (
    <div className="app">
      <Sidebar accountEmail={accountEmail} />
      {renderMain()}
    </div>
  );
}
