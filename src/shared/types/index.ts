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
  | { type: 'progress'; toolName: string; data: unknown; at: number }
  | { type: 'result'; toolName: string; output: unknown; at: number }
  | { type: 'error'; toolName: string; error: string; at: number };

/**
 * AgentEvent - the single event type for SSE transmission
 * ExecutionContext collects non-stream events for persistence
 */
export type AgentEvent =
  | { type: 'start'; at: number }
  | { type: 'thought'; content: string; at: number }
  | {
      type: 'tool_call';
      toolName: string;
      toolArgs: Record<string, unknown>;
      at: number;
    }
  | { type: 'tool_progress'; toolName: string; data: unknown; at: number }
  | { type: 'tool_result'; toolName: string; output: unknown; at: number }
  | { type: 'tool_error'; toolName: string; error: string; at: number }
  | { type: 'stream'; content: string; at: number }
  | { type: 'final'; at: number }
  | { type: 'error'; error: string; at: number };

