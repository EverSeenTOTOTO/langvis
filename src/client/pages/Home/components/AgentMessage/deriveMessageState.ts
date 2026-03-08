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
  /** Thought that immediately precedes this tool call (if any) */
  thought?: string;
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

  /** Standalone thoughts not associated with any tool (e.g., final thought before answer) */
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

  // Track pending thought that may be associated with the next tool call
  let pendingThought: string | undefined;

  for (const event of events) {
    switch (event.type) {
      case 'thought':
        // Store as pending - may be associated with next tool_call or kept as standalone
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
          // Associate the thought that immediately precedes this tool call
          thought: pendingThought,
        });
        // Clear pending thought after associating
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

      case 'stream':
      case 'final':
        // These events indicate the agent is finishing
        // Any remaining pending thought is a standalone thought (e.g., before final_answer)
        if (pendingThought) {
          thoughts.push({
            content: pendingThought,
            seq: event.seq,
            at: event.at,
          });
          pendingThought = undefined;
        }
        break;

      default:
        // start, error, cancelled - no special handling needed
        break;
    }
  }

  // Any remaining pending thought becomes a standalone thought
  if (pendingThought) {
    thoughts.push({
      content: pendingThought,
      seq: events.at(-1)?.seq ?? 0,
      at: events.at(-1)?.at ?? Date.now(),
    });
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
