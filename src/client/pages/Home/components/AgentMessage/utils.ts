/**
 * Utilities for Agent renderers
 *
 * Pure functions for event processing, tool block building, etc.
 */

import type { AgentEvent } from '@/shared/types/events';
import { buildToolTimeline } from '@/shared/types/tool';
import type { UIToolCall } from '@/client/store/modules/message-node';

// === Types ===

export interface ProgressData {
  status?: string;
  message?: string;
  schema?: Record<string, unknown>;
  event?: AgentEvent;
  [key: string]: unknown;
}

export interface ToolBlock {
  toolCall: UIToolCall;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

// === State derivation helper ===

export function buildToolBlocks(toolCalls: UIToolCall[]): ToolBlock[] {
  return toolCalls.map(toolCall => {
    const latestProgress = toolCall.progress.at(-1) as ProgressData | undefined;
    return {
      toolCall,
      latestProgress: latestProgress ?? null,
      isPending: toolCall.status === 'pending',
    };
  });
}

// === Recursive event extraction ===

/**
 * Extract nested agent events from tool progress data.
 * Used when rendering nested agent_call blocks.
 */
export function extractNestedEvents(progress: unknown[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const p of progress) {
    const data = p as ProgressData;
    if (data?.status === 'agent_event' && data.event) {
      events.push(data.event);
    }
  }
  return events;
}

/**
 * Build UIToolCall[] from nested agent events (for NestedAgentCallBlock).
 * Converts ToolCallTimeline (from buildToolTimeline) to UIToolCall format.
 */
export function buildUIToolCallsFromEvents(events: AgentEvent[]): UIToolCall[] {
  const timelines = buildToolTimeline(events);
  return timelines.map(tc => ({
    callId: tc.callId,
    toolName: tc.toolName,
    toolArgs: tc.toolArgs,
    status:
      tc.status === 'done'
        ? ('completed' as const)
        : tc.status === 'error'
          ? ('failed' as const)
          : ('pending' as const),
    progress: tc.progress,
    output: tc.output,
    error: tc.error,
  }));
}
