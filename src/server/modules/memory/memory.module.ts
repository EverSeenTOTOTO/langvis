import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { CACHE_PORT } from '@/server/modules/agent/agent.di-tokens';
import { LlmProvider } from './infrastructure/llm.provider';
import { CacheProvider } from './infrastructure/cache.provider';

/**
 * memory 模块装配根——注册本模块对外提供的实现（副作用 import，由 src/server/index.ts 加载）。
 *
 * - LLM_PORT → LlmProvider：LlmPort（内核契约）由 memory 实现，消费方按 token 注入——
 *   斩断 agent → memory 的引擎耦合。
 * - CACHE_SERVICE → CacheProvider：CachePort（agent 拥有的契约）由 memory 实现——
 *   此前该装配在 agent.module 里（agent 装配 memory 的类），现归位到 memory，
 *   agent 不再 import memory，memory→agent 为单向（实现 agent 的 cache 端口）。
 */
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CACHE_PORT, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});

// 本域 config fragment 自注册（defineConfigFragment）——基础库不反向认识任何域。
import './domain/service/compaction-config';
// 本域事件 handler：监听 conv 的压缩请求、自驱动历史压缩。
import './application/event/history-compaction.handler';
