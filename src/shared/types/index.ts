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
  // 并发声明：'parallel' = 只读/无本地副作用，可与同批其他 parallel 工具并发执行； 缺省 'serial' = 写操作或状态协调工具，执行时排干在飞行批独自运行（栅栏）。
  concurrency?: 'parallel' | 'serial';
}

// ─── DDD 类型 ───
export type { RunEvent, EnrichedEvent, StreamFrame } from './events';
export type { RunStatus, SkillInfo } from './agent';
export type { ReActStep, AwaitingInputProjection } from './render';
