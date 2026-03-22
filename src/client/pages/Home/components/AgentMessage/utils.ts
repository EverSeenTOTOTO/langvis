/**
 * Utilities for Agent renderers
 *
 * Pure functions for color hashing, awaiting input detection, etc.
 */

import type { SchemaProperty } from '@/client/components/SchemaField';
import type { AgentEvent } from '@/shared/types';
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
  event?: AgentEvent;
  [key: string]: unknown;
}

export interface ToolBlock {
  toolCall: ToolCallTimeline;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

export interface AgentCallBlock {
  callId: string;
  agentId?: string;
  status: 'pending' | 'done' | 'error';
  events: AgentEvent[];
  content: string;
  error?: string;
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

// === Agent call blocks ===

/**
 * Build AgentCallBlocks from tool_call events where toolName is 'agent_call'.
 * Each block contains nested events from the child agent.
 */
export function buildAgentCallBlocks(
  toolCallTimeline: ToolCallTimeline[],
): AgentCallBlock[] {
  const blocks: AgentCallBlock[] = [];

  for (const toolCall of toolCallTimeline) {
    // Check if this is an agent_call tool
    if (toolCall.toolName !== 'agent_call') continue;

    const nestedEvents: AgentEvent[] = [];
    let content = '';

    for (const progress of toolCall.progress) {
      const data = progress.data as ProgressData;

      // Extract nested agent events
      if (data?.status === 'agent_event' && data.event) {
        nestedEvents.push(data.event);
        if (data.event.type === 'stream') {
          content += data.event.content;
        }
      }
    }

    blocks.push({
      callId: toolCall.callId,
      status: toolCall.status,
      events: nestedEvents,
      content,
      error: toolCall.error,
    });
  }

  return blocks;
}

/**
 * Detect awaiting_input status from a flat list of agent events.
 * Used for nested agent call blocks.
 */
export function detectAwaitingInputInEvents(
  events: AgentEvent[],
): AwaitingInputData | null {
  for (const event of events) {
    if (event.type !== 'tool_progress') continue;

    const data = event.data as ProgressData;
    if (data?.status === 'awaiting_input' && data.schema) {
      return {
        message: data.message ?? 'Please provide input',
        schema: data.schema,
      };
    }
  }
  return null;
}
