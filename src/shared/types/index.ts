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
  /** Treat tool output as untrusted external content — wrapped with untrusted_content tags */
  untrustedOutput?: boolean;
}

// ─── DDD 类型 ───
export type { RunEvent, EnrichedEvent, StreamFrame } from './events';
export type { RunStatus, SkillInfo } from './agent';
export type { ReActStep, AwaitingInputProjection } from './render';
