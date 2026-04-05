/**
 * Utilities for Agent renderers
 *
 * Pure functions for event processing, tool block building, etc.
 */

import type { AgentEvent } from '@/shared/types';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';

// === Types ===

export interface ProgressData {
  status?: string;
  message?: string;
  schema?: Record<string, unknown>;
  event?: AgentEvent;
  [key: string]: unknown;
}

export interface ToolBlock {
  toolCall: ToolCallTimeline;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

// === State derivation helper ===

export function buildToolBlocks(
  toolCallTimeline: ToolCallTimeline[],
): ToolBlock[] {
  return toolCallTimeline.map(toolCall => {
    const latestProgress = toolCall.progress.at(-1)?.data as
      | ProgressData
      | undefined;
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
export function extractNestedEvents(
  progress: Array<{ data: unknown }>,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const p of progress) {
    const data = p.data as ProgressData;
    if (data?.status === 'agent_event' && data.event) {
      events.push(data.event);
    }
  }
  return events;
}

/**
 * Build a tool call timeline from a list of agent events.
 * Similar to deriveMessageState but returns just the timeline.
 */
export function buildToolTimeline(events: AgentEvent[]): ToolCallTimeline[] {
  const toolCallsMap = new Map<string, ToolCallTimeline>();

  for (const event of events) {
    switch (event.type) {
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
    }
  }

  return Array.from(toolCallsMap.values()).sort((a, b) => a.seq - b.seq);
}
