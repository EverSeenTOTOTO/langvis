export type { RunStatus } from '@/shared/types/agent';

/**
 * EnrichedEvent — AgentRun 推送的富化事件。
 *
 * 继承自 shared/types/events.ts 中的 EnrichedEvent 定义，
 * 此处仅 re-export，避免重复定义。
 */
export type { EnrichedEvent } from '@/shared/types/events';
export type { RunEvent } from '@/shared/types/events';
