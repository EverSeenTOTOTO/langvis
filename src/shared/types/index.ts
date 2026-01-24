import { JSONSchemaType } from 'ajv';

export interface AgentConfig<Config = Record<string, any>> {
  extends?: string;
  name: string;
  description: string;
  tools?: string[];
  configSchema?: JSONSchemaType<Config>;
  enabled?: boolean;
}

export interface ToolConfig<
  Input = Record<string, any>,
  Output = Record<string, any>,
> {
  extends?: string;
  name: string;
  description: string;
  inputSchema?: JSONSchemaType<Input>;
  outputSchema?: JSONSchemaType<Output>;
  enabled?: boolean;
}

export type StreamChunk =
  | string
  | { content: string; meta?: Record<string, any> }
  | { content?: string; meta: Record<string, any> };

export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'completion_error'; error: string }
  | {
      type: 'completion_delta';
      content?: string;
      meta?: Record<string, any>;
    }
  | {
      type: 'completion_done';
    };

export interface ConversationConfig {
  agent: string;
  [key: string]: any;
}
