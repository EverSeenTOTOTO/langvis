import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { CACHE_PORT } from '@/server/modules/agent/agent.di-tokens';
import { LlmProvider } from './infrastructure/llm.provider';
import { CacheProvider } from './infrastructure/cache.provider';
import { LOOP_MEMORY_PORT } from './domain/port/loop-memory.port';
import { LoopMemoryService } from './application/service/loop-memory.service';
import { CONVERSATION_MEMORY_PORT } from './domain/port/conversation-memory.port';
import { ConversationMemoryService } from './application/service/conversation-memory.service';

/**
 * memory 模块装配根——注册本模块对外提供的实现（副作用 import，由 src/server/index.ts 加载）。
 *
 * - LLM_PORT → LlmProvider：LlmPort（内核契约）由 memory 实现，消费方按 token 注入——
 *   斩断 agent → memory 的引擎耦合。
 * - CACHE_PORT → CacheProvider：CachePort（agent 拥有的契约）由 memory 实现——
 *   memory→agent 为单向（实现 agent 的 cache 端口）。
 * - LOOP_MEMORY_PORT → LoopMemoryService：agent 的 ReAct loop 经此同步端口操作 WorkingMemory
 *   （runId 索引；自发 loop 用量）。
 * - CONVERSATION_MEMORY_PORT → ConversationMemoryService：conv 经此同步端口操作 ConversationMemory
 *   （conversationId 索引；有效历史 + 用量 + fold 都在 memory，conv 只驱动生命周期）。
 *
 * memory 不监听任何 conv/agent 事件——只实现端口、自发 LoopUsageReported。
 */
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CACHE_PORT, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});
container.register(LOOP_MEMORY_PORT, LoopMemoryService, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CONVERSATION_MEMORY_PORT, ConversationMemoryService, {
  lifecycle: Lifecycle.Singleton,
});

// 本域 config fragment 自注册（defineConfigFragment）——基础库不反向认识任何域。
import './domain/service/compaction-config';
