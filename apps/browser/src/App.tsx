import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./store";

export function App() {
  const { ready } = useStore();

  if (!ready) {
    return <div className="no-session">Loading sessions…</div>;
  }

  return (
    <div className="app">
      <Sidebar />
      <ChatPanel />
    </div>
  );
}
