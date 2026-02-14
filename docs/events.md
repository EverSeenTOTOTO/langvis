# Event-Driven Streaming Architecture

This document outlines the design of the Server-Sent Events (SSE) streaming architecture used for communication between the backend agent and the frontend client. The core principle is a "Typed Event Stream," where every piece of information, from agent thoughts to tool outputs, is transmitted as a distinct, structured event.

## 1. Core Concepts

- **Everything is an AgentEvent**: All events flow through the agent. Tools yield `ToolEvent`s, which are adapted by the agent into `AgentEvent` variants (`tool_progress`, `tool_result`).
- **Single Event Type**: No wrapper types needed - `AgentEvent` is the single union type transmitted via SSE.
- **Extensible Payloads**: Tool-related events use generic `data: unknown` payload, allowing tools with complex intermediate outputs to be integrated without changing core event-handling logic.

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer           │  Responsibility                              │
├─────────────────────────────────────────────────────────────────┤
│  Tool            │  yield ToolEvent (progress/result)            │
│  Agent           │  yield AgentEvent (thought/tool_call/etc...) │
│  ExecutionContext│  Helper methods to create/adapt events        │
│  Service         │  Send AgentEvent via SSE                      │
│  Client          │  Parse AgentEvent, update UI accordingly     │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Event Types

### 3.1. AgentEvent

`AgentEvent` is the single event type transmitted via SSE. It encompasses all agent lifecycle events including tool interactions.

```typescript
export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'tool_call'; toolName: string; toolArgs: string }
  | { type: 'tool_progress'; toolName: string; data: unknown }
  | { type: 'tool_result'; toolName: string; output: string; isError?: boolean }
  | { type: 'stream'; content: string }
  | { type: 'final' }
  | { type: 'error'; error: string };
```

| Event           | Meaning                               | UI Behavior                                    |
| --------------- | ------------------------------------- | ---------------------------------------------- |
| `thought`       | Agent's internal reasoning process    | Collapsible display, optional visibility       |
| `tool_call`     | Agent decides to use a tool           | Show "Using tool xxx..." indicator             |
| `tool_progress` | Intermediate output from tool         | Display in tool card (tool-specific rendering) |
| `tool_result`   | Tool execution completed              | Collapse/show final result                     |
| `stream`        | A chunk of the agent's final response | Append to main message bubble                  |
| `final`         | Agent has finished responding         | Finalize message bubble                        |
| `error`         | An error occurred during execution    | Show error message                             |

### 3.2. ToolEvent (Internal)

`ToolEvent` is emitted by tools and adapted by agents into `AgentEvent` variants.

```typescript
export type ToolEvent =
  | { type: 'progress'; toolName: string; data: unknown }
  | { type: 'result'; toolName: string; output: string; isError?: boolean };
```

- **`progress`**: Reports **intermediate, non-final output** from a tool.
- **`result`**: Signals that the tool has finished execution.

## 4. Event Adaptation Flow

When an agent executes a tool, it adapts `ToolEvent`s to `AgentEvent` variants:

```
Tool yields ToolEvent        →  Agent adapts to AgentEvent
─────────────────────────────────────────────────────────────
{ type: 'progress', ... }    →  { type: 'tool_progress', ... }
{ type: 'result', ... }      →  { type: 'tool_result', ... }
```

## 5. Example `tool_progress` Payloads

The flexibility of `data: unknown` allows for rich, tool-specific intermediate reporting.

**A. Shell Command (`run_shell_command`)**

```json
{
  "type": "tool_progress",
  "toolName": "run_shell_command",
  "data": {
    "subtype": "stdout_chunk",
    "content": "-rw-r--r-- 1 user group 1024 Feb 12 10:00 file1.txt\n"
  }
}
```

**B. LLM Streaming (`llm_call`)**

```json
{
  "type": "tool_progress",
  "toolName": "llm_call",
  "data": "Hello, how can I"
}
```

**C. File Transfer (`FileTransfer`)**

```json
{
  "type": "tool_progress",
  "toolName": "FileTransfer",
  "data": {
    "subtype": "transfer_progress",
    "percent": 65
  }
}
```

## 6. Example Event Flow

User: "What are the files in `src`?"

```
1. thought
   { type: 'thought', content: 'I need to list the files in src directory...' }

2. tool_call
   { type: 'tool_call', toolName: 'run_shell_command', toolArgs: '{"command":"ls -l src"}' }
   → UI: Shows "Using run_shell_command..."

3. tool_progress (multiple)
   { type: 'tool_progress', toolName: 'run_shell_command', data: { subtype: 'stdout_chunk', content: '...' } }
   → UI: Appends to tool output display

4. tool_result
   { type: 'tool_result', toolName: 'run_shell_command', output: '{"stdout":"...","stderr":""}' }
   → UI: Marks tool execution as complete

5. thought
   { type: 'thought', content: 'I have the list of files. Now I will formulate the answer.' }

6. stream (multiple)
   { type: 'stream', content: 'The `src`' }
   { type: 'stream', content: ' directory contains:' }
   { type: 'stream', content: ' `client` and `server`.' }
   → UI: Streams to main message bubble

7. final
   { type: 'final' }
   → UI: Finalizes the message
```

## 7. Sub-Agent Calls

When an agent delegates to a sub-agent via a tool wrapper:

```typescript
@tool('call-agent')
class CallAgentTool extends Tool {
  async *call(input, ctx) {
    const subAgent = container.resolve(input.agentId);

    let finalContent = '';
    for await (const event of subAgent.call(memory, ctx, config)) {
      if (event.type === 'stream') {
        yield { type: 'progress', toolName: this.id, data: event.content };
        finalContent += event.content;
      }
      // Discard thought/tool_call events, or forward as progress
    }

    yield { type: 'result', toolName: this.id, output: finalContent };
  }
}
```

## 8. Type Definitions Summary

```typescript
// ToolEvent - emitted by Tools, internal to agent execution
export type ToolEvent =
  | { type: 'progress'; toolName: string; data: unknown }
  | { type: 'result'; toolName: string; output: string; isError?: boolean };

// AgentEvent - the single event type for SSE transmission
export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'tool_call'; toolName: string; toolArgs: string }
  | { type: 'tool_progress'; toolName: string; data: unknown }
  | { type: 'tool_result'; toolName: string; output: string; isError?: boolean }
  | { type: 'stream'; content: string }
  | { type: 'final' }
  | { type: 'error'; error: string };
```

## 9. ExecutionContext API

```typescript
class ExecutionContext {
  readonly traceId: string;
  readonly signal: AbortSignal;

  // Create pure AgentEvent
  agentEvent(event: AgentEvent): AgentEvent {
    return event;
  }

  // Create pure ToolEvent
  toolEvent(event: ToolEvent): ToolEvent {
    return event;
  }

  // Adapt ToolEvent to AgentEvent variant
  adaptToolEvent(event: ToolEvent): AgentEvent {
    if (event.type === 'progress') {
      return { type: 'tool_progress', ...event };
    }
    return { type: 'tool_result', ...event };
  }

  static create(traceId: string, signal: AbortSignal): ExecutionContext {
    return new ExecutionContext(traceId, signal);
  }
}
```

The ExecutionContext provides helper methods for creating and adapting events. Agents are responsible for adapting tool events before yielding them.
