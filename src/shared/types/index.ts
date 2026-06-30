import { JSONSchemaType } from 'ajv';

/** model 域配置（chat 模型选择）——由 MODEL_FRAGMENT 发布，消费方直接从 runtimeConfig.model 读取。 */
export interface ModelConfig {
  modelId?: string;
  temperature?: number;
  topP?: number;
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
export type { RunEvent, EnrichedEvent, SSEFrame } from './events';
export type { RunStatus } from './agent';
export type { ToolCallRecord, RunSnapshot } from './render';
