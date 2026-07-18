import { useEffect } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { setupDesktopIntegration } from "./desktopIntegration";
import { useStore } from "./store";

export function App() {
  const { ready, createSession, accountsManagerOpen } = useStore();

  useEffect(() => {
    const teardown = setupDesktopIntegration({ onNewSession: () => createSession() });
    return () => {
      void teardown.then((unsubscribe) => unsubscribe());
    };
  }, [createSession]);

  if (!ready) {
    return <div className="no-session">Loading sessions…</div>;
  }

  return (
    <div className="app">
      <Sidebar />
      <ChatPanel />
      {accountsManagerOpen && <AccountsManager />}
    </div>
  );
}
