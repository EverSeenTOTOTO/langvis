import { JSONSchemaType } from 'ajv';

export interface UploadConfig {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types, e.g. ['image/*', 'application/pdf'] */
  allowedTypes?: string[];
  /** Maximum number of files per upload */
  maxCount?: number;
}

export interface AgentConfig<
  Config = Record<string, unknown>,
  Input = Record<string, unknown>,
> {
  extends?: string;
  name: string;
  description: string;
  tools?: string[];
  /** Runtime configuration schema (e.g., model, temperature) */
  configSchema?: JSONSchemaType<Config>;
  /** Input schema for child agent invocation (context, query, etc.) */
  inputSchema?: JSONSchemaType<Input>;
  enabled?: boolean;
  upload?: UploadConfig;
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
  /** Output compression strategy: 'redis' stores large content in Redis, 'file' writes to workspace temp file, 'skip' returns as-is */
  compression?: 'skip' | 'redis' | 'file';
  /** Mark tool output as untrusted/external content — will be wrapped with untrusted_content tags in the agent loop */
  untrustedOutput?: boolean;
}

/**
 * AgentEvent - the single event type for SSE transmission
 * ExecutionContext collects non-stream events for persistence
 *
 * Tools yield tool_progress events and return results via generator return.
 * Agents manage tool_call/tool_result/tool_error events.
 *
 * All events carry messageId for frontend routing in multi-message scenarios.
 */
export type AgentEvent =
  | { type: 'start'; messageId: string; seq: number; at: number }
  | {
      type: 'thought';
      messageId: string;
      content: string;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_call';
      messageId: string;
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_progress';
      messageId: string;
      callId: string;
      toolName: string;
      data: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_result';
      messageId: string;
      callId: string;
      toolName: string;
      output: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_error';
      messageId: string;
      callId: string;
      toolName: string;
      error: string;
      seq: number;
      at: number;
    }
  | {
      type: 'stream';
      messageId: string;
      content: string;
      seq: number;
      at: number;
    }
  | { type: 'final'; messageId: string; seq: number; at: number }
  | {
      type: 'cancelled';
      messageId: string;
      reason: string;
      seq: number;
      at: number;
    }
  | {
      type: 'error';
      messageId: string;
      error: string;
      seq: number;
      at: number;
    }
  | {
      type: 'context_usage';
      messageId: string;
      used: number;
      total: number;
      seq: number;
      at: number;
    };

/**
 * SSEMessage - the transmission type over SSE channel
 * Includes control messages (connected, heartbeat, session_error) and business events (AgentEvent)
 */
export type SSEMessage =
  | { type: 'connected'; conversationId: string }
  | { type: 'heartbeat' }
  | { type: 'session_replaced' }
  | { type: 'session_error'; error: string }
  | AgentEvent;

/**
 * ConversationPhase - frontend conversation FSM phases
 */
export type ConversationPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'active'
  | 'canceling'
  | 'error'
  | 'canceled';

export type SessionPhase =
  | 'waiting'
  | 'active'
  | 'canceling'
  | 'error'
  | 'done';

/**
 * MessagePhase - unified message FSM phases (frontend & backend)
 */
export type MessagePhase =
  | 'initialized'
  | 'streaming'
  | 'awaiting_input'
  | 'submitting'
  | 'canceling'
  | 'final'
  | 'canceled'
  | 'error';
