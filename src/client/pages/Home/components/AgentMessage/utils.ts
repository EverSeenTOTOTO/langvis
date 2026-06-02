/**
 * Utilities for Agent renderers
 *
 * Pure functions for event processing, tool block building, etc.
 */

import type { AgentEvent } from '@/shared/types/events';
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
