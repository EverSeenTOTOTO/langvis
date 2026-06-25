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
  /** Output compression strategy: 'file' writes large content to workspace temp file, 'skip' returns as-is */
  compression?: 'skip' | 'file';
  /** Mark tool output as untrusted/external content — will be wrapped with untrusted_content tags in the agent loop */
  untrustedOutput?: boolean;
}

// ─── DDD 类型 ───
export type {
  RunEvent,
  EnrichedEvent,
  ContextUsageMeta,
  SSEFrame,
} from './events';
export type { RunStatus } from './agent';
export type { ToolCallRecord, RunSnapshot } from './render';
