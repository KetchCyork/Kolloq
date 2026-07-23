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
  /** Insertion order shared with `subAgentMessages`, so the two lists can be interleaved back into
   * one chronological sequence. */
  seq: number;
}

/** A sub-agent's plain-text answer — the delegated-agent equivalent of `text` above, since a
 * sub-agent isn't the one turn's single streaming voice and so can't just append to it. */
export interface StepTrackerAgentMessage {
  id: string;
  text: string;
  /** >0 — a sub-agent reached via `delegate_task`. */
  depth: number;
  agentName: string;
  seq: number;
}

export interface StepTrackerProps {
  text?: string;
  toolCalls: StepTrackerToolCall[];
  subAgentMessages?: StepTrackerAgentMessage[];
  error?: string;
  /** Shown instead of the default "…" placeholder while nothing has streamed in yet. */
  pendingLabel?: ReactNode;
}

type Step =
  | { kind: "tool-call"; seq: number; call: StepTrackerToolCall }
  | { kind: "agent-message"; seq: number; message: StepTrackerAgentMessage };

/**
 * Renders one in-flight turn as a sequence of steps — assistant text, tool calls with live
 * status, and (when `depth`/`agentName` are set) sub-agent delegations indented under their
 * parent — so a multi-agent session's reasoning is visible as it happens, not just the final answer.
 * Tool calls and sub-agent text messages arrive as two separate lists; `seq` (shared insertion order
 * across both) puts them back into one chronological sequence for rendering.
 */
export function StepTracker({ text, toolCalls, subAgentMessages = [], error, pendingLabel }: StepTrackerProps) {
  const isEmpty = !text && toolCalls.length === 0 && subAgentMessages.length === 0 && !error;

  const steps: Step[] = [
    ...toolCalls.map((call): Step => ({ kind: "tool-call", seq: call.seq, call })),
    ...subAgentMessages.map((message): Step => ({ kind: "agent-message", seq: message.seq, message })),
  ].sort((a, b) => a.seq - b.seq);

  return (
    <div className="step-tracker">
      {text && <div className="step-tracker-text">{text}</div>}

      {steps.map((step) =>
        step.kind === "tool-call" ? (
          <div key={step.call.id} className="step-tracker-step" style={{ marginLeft: (step.call.depth ?? 0) * 16 }}>
            <div className="step-tracker-step-head">
              <span aria-hidden="true">🔧</span>
              {step.call.agentName && <span className="step-tracker-agent">{step.call.agentName}</span>}
              <span className="step-tracker-name">{step.call.name}</span>
              <span className={`status-badge ${step.call.status}`}>{step.call.status}</span>
            </div>
            <div className="step-tracker-step-body">
              {JSON.stringify(step.call.arguments)}
              {step.call.result !== undefined ? `\n→ ${JSON.stringify(step.call.result)}` : ""}
            </div>
          </div>
        ) : (
          <div key={step.message.id} className="step-tracker-step" style={{ marginLeft: step.message.depth * 16 }}>
            <div className="step-tracker-step-head">
              <span aria-hidden="true">💬</span>
              <span className="step-tracker-agent">{step.message.agentName}</span>
            </div>
            <div className="step-tracker-step-body">{step.message.text}</div>
          </div>
        ),
      )}

      {error && <div className="step-tracker-error">⚠️ {error}</div>}

      {isEmpty && (pendingLabel ?? <div className="step-tracker-text">…</div>)}
    </div>
  );
}
