import { container, Lifecycle } from 'tsyringe';
import { AGENT_RUN_REPOSITORY, CACHE_PORT } from './agent.di-tokens';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';
import { CacheProvider } from './infrastructure/cache.provider';

container.register(AGENT_RUN_REPOSITORY, AgentRunRepository, {
  lifecycle: Lifecycle.Singleton,
});

// CachePort（本域拥有的契约）的文件缓存实现——消费者按 CACHE_PORT 注入
// （agent-run-executor / CachedRead / tool-call / email-archived）。
// memory 解散后，端口的实现回归端口所有者（agent）。
container.register(CACHE_PORT, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});

import './application/event/agent-run.handler';
import './application/event/cancel-run.handler';
// 本域 config fragment 自注册（defineConfigFragment）——基础库不反向认识任何域。
import './application/service/model-config.fragment';
