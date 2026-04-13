/**
 * Utilities for Agent renderers
 *
 * Pure functions for event processing, tool block building, etc.
 */

import type { AgentEvent, ToolCallTimeline } from '@/shared/types';
import { buildToolTimeline as sharedBuildToolTimeline } from '@/shared/types/tool';

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
 * Delegates to shared implementation.
 */
export const buildToolTimeline = sharedBuildToolTimeline;
