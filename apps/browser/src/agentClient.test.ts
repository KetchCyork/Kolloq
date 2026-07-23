import type { OrchestratedAgentEvent } from "@newvector/core";
import { describe, expect, it } from "vitest";
import { eventsToMessages } from "./agentClient";

function assistantMessageEvent(
  overrides: Partial<OrchestratedAgentEvent> & { agentId: string; depth: number },
): OrchestratedAgentEvent {
  return {
    type: "assistant-message",
    message: { role: "assistant", content: "" },
    agentName: "sub-agent",
    ...overrides,
  } as OrchestratedAgentEvent;
}

describe("eventsToMessages", () => {
  it("includes depth-0 (root agent) events but leaves them untagged, matching pre-multi-agent sessions", () => {
    const events: OrchestratedAgentEvent[] = [
      assistantMessageEvent({ agentId: "agent-1", depth: 0, message: { role: "assistant", content: "root text" } }),
    ];

    expect(eventsToMessages(events)).toEqual([{ role: "assistant", content: "root text" }]);
  });

  it("preserves chronological order across root and sub-agent events, e.g. root's delegate_task call before the sub-agent's own activity", () => {
    const events: OrchestratedAgentEvent[] = [
      assistantMessageEvent({
        agentId: "agent-1",
        depth: 0,
        message: { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "delegate_task", arguments: {} }] },
      }),
      assistantMessageEvent({
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
        message: { role: "assistant", content: "sub-agent answer" },
      }),
      {
        type: "tool-result",
        toolCall: { id: "call_1", name: "delegate_task", arguments: {} },
        result: { results: [{ name: "researcher", result: "sub-agent answer" }] },
        agentId: "agent-1",
        agentName: "root",
        depth: 0,
      },
      assistantMessageEvent({
        agentId: "agent-1",
        depth: 0,
        message: { role: "assistant", content: "final synthesis" },
      }),
    ];

    const messages = eventsToMessages(events);

    expect(messages.map((m) => m.content)).toEqual([
      "", // root's delegate_task call
      "sub-agent answer",
      JSON.stringify({ results: [{ name: "researcher", result: "sub-agent answer" }] }),
      "final synthesis",
    ]);
    expect(messages[0]?.agentId).toBeUndefined();
    expect(messages[1]?.agentId).toBe("agent-2");
    expect(messages[2]?.agentId).toBeUndefined();
    expect(messages[3]?.agentId).toBeUndefined();
  });

  it("tags sub-agent assistant-message and tool-result events with agentId/agentName/parentId/depth", () => {
    const events: OrchestratedAgentEvent[] = [
      {
        type: "tool-call",
        toolCall: { id: "call_1", name: "lookup", arguments: { q: "x" } },
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
      },
      {
        type: "tool-result",
        toolCall: { id: "call_1", name: "lookup", arguments: { q: "x" } },
        result: { hits: 3 },
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
      },
      assistantMessageEvent({
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
        message: { role: "assistant", content: "X is fine." },
      }),
    ];

    const messages = eventsToMessages(events);

    // The plain "tool-call" event (no result yet) never becomes a message, same as AgentRunner's
    // own turnMessages — only the resolved "tool-result" does.
    expect(messages).toEqual([
      {
        role: "tool",
        name: "lookup",
        toolCallId: "call_1",
        content: JSON.stringify({ hits: 3 }),
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
      },
      {
        role: "assistant",
        content: "X is fine.",
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
      },
    ]);
  });

  it("stringifies non-string tool results, same as AgentRunner's own tool message construction", () => {
    const events: OrchestratedAgentEvent[] = [
      {
        type: "tool-result",
        toolCall: { id: "call_1", name: "get_time", arguments: {} },
        result: "2026-07-23T00:00:00.000Z",
        agentId: "agent-2",
        agentName: "researcher",
        parentId: "agent-1",
        depth: 1,
      },
    ];

    expect(eventsToMessages(events)[0]?.content).toBe("2026-07-23T00:00:00.000Z");
  });
});
