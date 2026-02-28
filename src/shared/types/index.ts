import { JSONSchemaType } from 'ajv';

export interface AgentConfig<Config = Record<string, unknown>> {
  extends?: string;
  name: string;
  description: string;
  tools?: string[];
  configSchema?: JSONSchemaType<Config>;
  enabled?: boolean;
}

export interface ToolConfig<
  Input = Record<string, unknown>,
  Output = Record<string, unknown>,
> {
  extends?: string;
  name: string;
  description: string;
  inputSchema?: JSONSchemaType<Input>;
  outputSchema?: JSONSchemaType<Output>;
  enabled?: boolean;
}

/**
 * ToolEvent - emitted by Tools, internal to agent execution
 */
export type ToolEvent =
  | {
      type: 'progress';
      callId: string;
      toolName: string;
      data: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'result';
      callId: string;
      toolName: string;
      output: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'error';
      callId: string;
      toolName: string;
      error: string;
      seq: number;
      at: number;
    };

/**
 * AgentEvent - the single event type for SSE transmission
 * ExecutionContext collects non-stream events for persistence
 */
export type AgentEvent =
  | { type: 'start'; seq: number; at: number }
  | { type: 'thought'; content: string; seq: number; at: number }
  | {
      type: 'tool_call';
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_progress';
      callId: string;
      toolName: string;
      data: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      output: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_error';
      callId: string;
      toolName: string;
      error: string;
      seq: number;
      at: number;
    }
  | { type: 'stream'; content: string; seq: number; at: number }
  | { type: 'final'; seq: number; at: number }
  | { type: 'cancelled'; reason: string; seq: number; at: number }
  | { type: 'error'; error: string; seq: number; at: number };

/**
 * SSEMessage - the transmission type over SSE channel
 * Includes control messages (connected, heartbeat, session_error) and business events (AgentEvent)
 */
export type SSEMessage =
  | { type: 'connected'; conversationId: string }
  | { type: 'heartbeat' }
  | { type: 'session_error'; error: string }
  | AgentEvent;

/**
 * ChatPhase - frontend conversation state machine phases
 */
export type ChatPhase =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'finishing'
  | 'error'
  | 'cancelled';
