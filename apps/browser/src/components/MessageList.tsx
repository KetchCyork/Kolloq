import { useEffect, useRef } from "react";
import type { LiveTurn } from "../store";
import type { AgentSession } from "../types";
import { MessageItem } from "./MessageItem";

export function MessageList({ session, live }: { session: AgentSession; live?: LiveTurn }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [session.messages.length, live?.text, live?.toolCalls.length]);

  if (session.messages.length === 0 && !live) {
    return (
      <div className="messages">
        <div className="empty-state">
          Start a conversation with {session.identity.name}. Messages stream live and tool calls are shown inline.
        </div>
      </div>
    );
  }

  return (
    <div className="messages">
      {session.messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}

      {live && (
        <div className="message role-assistant">
          <div>
            {live.text && <div className="bubble">{live.text}</div>}
            {live.toolCalls.map((tc) => (
              <div className="tool-card" key={tc.call.id}>
                <div className="tool-card-head">
                  <span>🔧</span>
                  <span>{tc.call.name}</span>
                  <span className={`status-badge ${tc.status}`}>{tc.status}</span>
                </div>
                <div className="tool-card-body">
                  {JSON.stringify(tc.call.arguments)}
                  {tc.result !== undefined ? `\n→ ${JSON.stringify(tc.result)}` : ""}
                </div>
              </div>
            ))}
            {live.error && <div className="tool-card">⚠️ {live.error}</div>}
            {!live.text && live.toolCalls.length === 0 && !live.error && <div className="bubble">…</div>}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
