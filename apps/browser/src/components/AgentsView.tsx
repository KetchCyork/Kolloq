import { useState } from "react";
import { getAgentStatus } from "../agentStatus";
import { useStore } from "../store";
import type { AgentSession } from "../types";
import { PROVIDER_LABELS } from "../utils";
import { AgentDrawer } from "./AgentDrawer";

type DrawerState = { agentId: string; mode: "create" | "edit" };

export function AgentsView() {
  const { sessions, accounts, createSession, setCurrentView } = useStore();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  function openCreateDrawer() {
    const session = createSession();
    // createSession() also switches to the Chat view (its normal sidebar behavior) — stay put here.
    setCurrentView("agents");
    setDrawer({ agentId: session.id, mode: "create" });
  }

  function openEditDrawer(session: AgentSession) {
    setDrawer({ agentId: session.id, mode: "edit" });
  }

  return (
    <div className="main">
      <div className="chat-header">
        <span>Agents</span>
        <div style={{ flex: 1 }} />
        <button className="primary-btn" onClick={openCreateDrawer}>
          + New agent
        </button>
      </div>

      <div className="agents-page">
        <div className="agent-grid">
          {sessions.map((session) => {
            const status = getAgentStatus(session.providerConfig, accounts);
            return (
              <button key={session.id} className="agent-card" onClick={() => openEditDrawer(session)}>
                <div className="agent-card-row">
                  <span className="agent-card-dot" style={{ background: session.identity.color }} />
                  <h3 className="agent-card-name">{session.identity.name}</h3>
                  <span className={`badge ${status.status === "ready" ? "green" : "red"} agent-card-badge`}>
                    {status.label}
                  </span>
                </div>
                <div className="sub agent-card-sub">
                  {session.providerConfig.model} · {PROVIDER_LABELS[session.providerConfig.provider]}
                  {status.detail ? ` — ${status.detail}` : ""}
                </div>
                <div className="agent-card-kv">
                  <span>
                    Skills <b>0</b>
                  </span>
                  <span>
                    Tools <b>0</b>
                  </span>
                  <span>
                    This month <b>—</b>
                  </span>
                </div>
              </button>
            );
          })}

          <button className="agent-card agent-card-template" onClick={openCreateDrawer}>
            + Create from template
          </button>
        </div>

        {sessions.length === 0 && (
          <div className="empty-state" style={{ marginTop: 20 }}>
            No agents yet. Create one to give it a name, a model, and a persona.
          </div>
        )}
      </div>

      {drawer && (
        <AgentDrawer
          agentId={drawer.agentId}
          mode={drawer.mode}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
