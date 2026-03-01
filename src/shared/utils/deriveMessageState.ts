import type { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';

/**
 * A single tool call's complete lifecycle with temporal ordering
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
};

export type ThoughtItem = {
  content: string;
  seq: number;
  at: number;
};

export type MessageRenderState = {
  hasContent: boolean;
  hasEvents: boolean;
  isTerminated: boolean;

  // Agent started but nothing visible yet (no content, no pending tools)
  isAwaitingContent: boolean;

  // Core: tool calls ordered by seq
  toolCallTimeline: ToolCallTimeline[];

  // Convenience accessors
  pendingToolCalls: ToolCallTimeline[];
  hasPendingTools: boolean;

  // Non-tool events
  thoughts: ThoughtItem[];

  // Raw events for special cases
  rawEvents: AgentEvent[];
};

/**
 * Derive message render state from events
 * Used by both frontend and SSR
 */
export function deriveMessageState(msg: Message): MessageRenderState {
  const events = msg.meta?.events ?? [];
  const content = msg.content ?? '';

  const hasContent = content.length > 0;
  const hasEvents = events.length > 0;

  // Check terminal events
  const isTerminal = events.some((e: AgentEvent) =>
    ['final', 'error', 'cancelled'].includes(e.type),
  );

  // Build tool call timeline indexed by callId
  const toolCallsMap = new Map<string, ToolCallTimeline>();
  const thoughts: ThoughtItem[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'thought':
        thoughts.push({
          content: event.content,
          seq: event.seq,
          at: event.at,
        });
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
        });
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

      default:
        // start, stream, final, error, cancelled - no special handling needed
        break;
    }
  }

  // Sort by seq to maintain temporal order
  const toolCallTimeline = Array.from(toolCallsMap.values()).sort(
    (a, b) => a.seq - b.seq,
  );

  const pendingToolCalls = toolCallTimeline.filter(t => t.status === 'pending');
  const hasPendingTools = pendingToolCalls.length > 0;

  return {
    hasContent,
    hasEvents,
    isTerminated: isTerminal,
    isAwaitingContent:
      hasEvents && !isTerminal && !hasContent && !hasPendingTools,
    toolCallTimeline,
    pendingToolCalls,
    hasPendingTools,
    thoughts,
    rawEvents: events,
  };
}
