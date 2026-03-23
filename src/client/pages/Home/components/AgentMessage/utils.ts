/**
 * Utilities for Agent renderers
 *
 * Pure functions for event processing, awaiting input detection, etc.
 */

import type { SchemaProperty } from '@/client/components/SchemaField';
import type { AgentEvent } from '@/shared/types';
import type { ToolCallTimeline } from './deriveMessageState';

// === Types ===

export type HumanInputState =
  | { type: 'awaiting'; message: string; schema: SchemaProperty }
  | { type: 'submitted'; submittedData: Record<string, unknown> }
  | { type: 'completed'; submittedData: Record<string, unknown> }
  | { type: 'timeout' }
  | null;

export interface AwaitingInputData {
  message: string;
  schema: SchemaProperty;
}

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

/**
 * Detect awaiting_input status from a flat list of agent events.
 * Used for nested agent call blocks.
 *
 * Only returns awaiting_input if the tool call hasn't completed yet
 * (no tool_result or tool_error for the same callId).
 */
export function detectAwaitingInputInEvents(
  events: AgentEvent[],
): AwaitingInputData | null {
  // First, build a set of completed callIds
  const completedCallIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool_result' || event.type === 'tool_error') {
      completedCallIds.add(event.callId);
    }
  }

  // Then find awaiting_input progress that hasn't been completed
  for (const event of events) {
    if (event.type !== 'tool_progress') continue;

    const data = event.data as ProgressData;
    if (data?.status === 'awaiting_input' && data.schema) {
      // Skip if this tool call already has a result
      if (completedCallIds.has(event.callId)) {
        continue;
      }
      return {
        message: data.message ?? 'Please provide input',
        schema: data.schema,
      };
    }
  }
  return null;
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

/**
 * Recursively detect awaiting_input status from agent events.
 * Checks current level and all nested agent_call blocks.
 */
export function detectAwaitingInputRecursive(
  events: AgentEvent[],
): AwaitingInputData | null {
  // Check current level first
  const found = detectAwaitingInputInEvents(events);
  if (found) return found;

  // Recursively check nested agent_call blocks
  for (const event of events) {
    if (event.type !== 'tool_call' || event.toolName !== 'agent_call') continue;

    // Find tool_progress events for this agent_call
    const progress: Array<{ data: unknown }> = [];
    for (const e of events) {
      if (e.type === 'tool_progress' && e.callId === event.callId) {
        progress.push({ data: e.data });
      }
    }

    const nestedEvents = extractNestedEvents(progress);
    const nestedFound = detectAwaitingInputRecursive(nestedEvents);
    if (nestedFound) return nestedFound;
  }

  return null;
}
