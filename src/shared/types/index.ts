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
 * StepEvent - aggregated step stored in message.meta.steps
 */
export type StepEvent =
  | { type: 'thought'; content: string }
  | {
      type: 'tool';
      name: string;
      args: string;
      output?: string;
      error?: string;
    };

/**
 * EventMeta - metadata carried by AgentEvent for real-time sync
 */
export interface EventMeta {
  steps: StepEvent[];
}

/**
 * ToolEvent - emitted by Tools, internal to agent execution
 */
export type ToolEvent =
  | { type: 'progress'; toolName: string; data: unknown }
  | { type: 'result'; toolName: string; output: string }
  | { type: 'error'; toolName: string; error: string };

/**
 * AgentEvent - the single event type for SSE transmission
 * Non-stream events carry meta.steps for frontend to merge
 */
export type AgentEvent =
  | { type: 'thought'; content: string; meta?: EventMeta }
  | { type: 'tool_call'; toolName: string; toolArgs: string; meta?: EventMeta }
  | { type: 'tool_progress'; toolName: string; data: unknown }
  | { type: 'tool_result'; toolName: string; output: string; meta?: EventMeta }
  | { type: 'tool_error'; toolName: string; error: string; meta?: EventMeta }
  | { type: 'stream'; content: string }
  | { type: 'final' }
  | { type: 'error'; error: string };
