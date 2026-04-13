import type { AgentEvent } from '.';

/**
 * ToolCallTimeline - structured view of a single tool invocation
 * built from paired tool_call + tool_result/tool_error events.
 */
export type ToolCallTimeline = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  seq: number;
  at: number;
  status: 'pending' | 'done' | 'error';
  output?: unknown;
  error?: string;
  progress: Array<{ data: unknown; seq: number; at: number }>;
  thought?: string;
};

/**
 * Build a tool call timeline from a list of agent events.
 * Pairs tool_call with tool_result/tool_error/tool_progress by callId.
 */
export function buildToolTimeline(events: AgentEvent[]): ToolCallTimeline[] {
  const toolCallsMap = new Map<string, ToolCallTimeline>();
  let pendingThought: string | undefined;

  for (const event of events) {
    switch (event.type) {
      case 'thought':
        pendingThought = event.content;
        break;

      case 'tool_call':
        toolCallsMap.set(event.callId, {
          callId: event.callId,
          toolName: event.toolName,
          toolArgs: event.toolArgs,
          seq: event.seq,
          at: event.at,
          status: 'pending',
          progress: [],
          thought: pendingThought,
        });
        pendingThought = undefined;
        break;

      case 'tool_result': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.status = 'done';
          existing.output = event.output;
        }
        break;
      }

      case 'tool_error': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.status = 'error';
          existing.error = event.error;
        }
        break;
      }

      case 'tool_progress': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.progress.push({
            data: event.data,
            seq: event.seq,
            at: event.at,
          });
        }
        break;
      }
    }
  }

  return Array.from(toolCallsMap.values()).sort((a, b) => a.seq - b.seq);
}
