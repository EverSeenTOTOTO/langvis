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
  | { type: 'progress'; toolName: string; data: unknown }
  | { type: 'result'; toolName: string; output: string; isError?: boolean };

/**
 * AgentEvent - the single event type for SSE transmission
 */
export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'tool_call'; toolName: string; toolArgs: string }
  | { type: 'tool_progress'; toolName: string; data: unknown }
  | { type: 'tool_result'; toolName: string; output: string; isError?: boolean }
  | { type: 'stream'; content: string }
  | { type: 'final' }
  | { type: 'error'; error: string };
