import { StepTracker } from "@newvector/ui";
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
          <StepTracker
            text={live.text}
            error={live.error}
            toolCalls={live.toolCalls.map((tc) => ({
              id: tc.call.id,
              name: tc.call.name,
              arguments: tc.call.arguments,
              status: tc.status,
              result: tc.result,
              agentName: tc.agentName,
              depth: tc.depth,
              seq: tc.seq,
            }))}
            subAgentMessages={live.subAgentMessages.map((message) => ({
              id: message.id,
              text: message.text,
              depth: message.depth,
              agentName: message.agentName,
              seq: message.seq,
            }))}
          />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
