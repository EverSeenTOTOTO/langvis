/**
 * Utilities for Agent renderers
 *
 * Pure functions for color hashing, awaiting input detection, etc.
 */

import type { SchemaProperty } from '@/client/components/SchemaField';
import type { ToolCallTimeline } from './deriveMessageState';

// === Types ===

export type AwaitingInputData = {
  message: string;
  schema: SchemaProperty;
};

export interface ProgressData {
  status?: string;
  message?: string;
  schema?: SchemaProperty;
  [key: string]: unknown;
}

export interface ToolBlock {
  toolCall: ToolCallTimeline;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

// === Color utilities ===

const TAG_COLORS = [
  'magenta',
  'red',
  'volcano',
  'orange',
  'gold',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getToolColor(toolName: string): string {
  return TAG_COLORS[hashString(toolName) % TAG_COLORS.length];
}

// === Awaiting input detection ===

/**
 * Detect awaiting_input status from any pending tool's progress.
 * This works for both direct HumanInTheLoop calls and indirect calls
 * (e.g., PositionAdjustTool calling HumanInTheLoopTool internally).
 */
export function detectAwaitingInput(
  toolBlocks: ToolBlock[],
): AwaitingInputData | null {
  for (const block of toolBlocks) {
    if (!block.isPending) continue;

    for (const progress of block.toolCall.progress) {
      const data = progress.data as ProgressData;
      if (data?.status === 'awaiting_input' && data.schema) {
        return {
          message: data.message ?? 'Please provide input',
          schema: data.schema,
        };
      }
    }
  }
  return null;
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
