import type { AgentEvent } from '@/shared/types/events';
import type { StreamChunk } from '@/shared/types/events';

export type { RunStatus } from '@/shared/types/agent';

/**
 * AgentRun.emit() 产出的 enriched event。
 * 在 AgentEvent / StreamChunk 基础上注入 seq + at。
 * 应用层再添加 messageId 构成 SSEFrame。
 */
export type EnrichedEvent = (AgentEvent | StreamChunk) & {
  seq: number;
  at: number;
};
