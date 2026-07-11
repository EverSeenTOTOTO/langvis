import { JSONSchemaType } from 'ajv';

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
export type { RunEvent, EnrichedEvent, StreamFrame } from './events';
export type { RunStatus, SkillInfo } from './agent';
export type { ReActStep, AwaitingInputProjection } from './render';
