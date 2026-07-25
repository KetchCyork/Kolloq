# Multi-agent orchestration

A parent agent session can delegate subtasks to named sub-agents. Each sub-agent has its own:

- Identity (name, color, emoji)
- Provider and model
- Tool permissions
- System prompt

Sub-agent calls appear in the step tracker UI as indented items under the parent step.

## How it works

The orchestrator tool is registered automatically when a session has orchestration enabled. The parent agent calls it like any other tool:

```json
{
  "tool": "delegate",
  "input": {
    "agentName": "Researcher",
    "task": "Find the top 3 papers on transformer attention published in 2024",
    "provider": "anthropic",
    "model": "claude-sonnet-5"
  }
}
```

The runner spawns a child `AgentRunner`, streams its events back to the parent session's event bus, and returns the sub-agent's final text output as the tool result.

## Enabling orchestration

In the browser app: open Session Settings → enable "Allow sub-agents". The orchestrator tool is added to the session's tool registry.

In the CLI: pass `--orchestration` to `agent-cli`.

## Step tracker

The step tracker panel (right side of the chat UI) shows a live tree of tool calls and sub-agent delegations. Each node shows status (running / done / error) and the sub-agent's identity.
