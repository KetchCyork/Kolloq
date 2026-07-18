import type { ReactNode } from "react";

export interface StepTrackerToolCall {
  id: string;
  name: string;
  arguments: unknown;
  status: "running" | "done" | "error";
  result?: unknown;
  /** 0 = the top-level agent; >0 = a sub-agent reached via `delegate_task`. */
  depth?: number;
  /** Which agent made this call — shown as a label so a multi-agent session reads as a tree. */
  agentName?: string;
}

export interface StepTrackerProps {
  text?: string;
  toolCalls: StepTrackerToolCall[];
  error?: string;
  /** Shown instead of the default "…" placeholder while nothing has streamed in yet. */
  pendingLabel?: ReactNode;
}

/**
 * Renders one in-flight turn as a sequence of steps — assistant text, tool calls with live
 * status, and (when `depth`/`agentName` are set) sub-agent delegations indented under their
 * parent — so a multi-agent session's reasoning is visible as it happens, not just the final answer.
 */
export function StepTracker({ text, toolCalls, error, pendingLabel }: StepTrackerProps) {
  const isEmpty = !text && toolCalls.length === 0 && !error;

  return (
    <div className="step-tracker">
      {text && <div className="step-tracker-text">{text}</div>}

      {toolCalls.map((call) => (
        <div key={call.id} className="step-tracker-step" style={{ marginLeft: (call.depth ?? 0) * 16 }}>
          <div className="step-tracker-step-head">
            <span aria-hidden="true">🔧</span>
            {call.agentName && <span className="step-tracker-agent">{call.agentName}</span>}
            <span className="step-tracker-name">{call.name}</span>
            <span className={`status-badge ${call.status}`}>{call.status}</span>
          </div>
          <div className="step-tracker-step-body">
            {JSON.stringify(call.arguments)}
            {call.result !== undefined ? `\n→ ${JSON.stringify(call.result)}` : ""}
          </div>
        </div>
      ))}

      {error && <div className="step-tracker-error">⚠️ {error}</div>}

      {isEmpty && (pendingLabel ?? <div className="step-tracker-text">…</div>)}
    </div>
  );
}
