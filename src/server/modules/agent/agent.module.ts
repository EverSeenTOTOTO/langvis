import { container, Lifecycle } from 'tsyringe';
import { AGENT_RUN_REPOSITORY, CACHE_PORT } from './agent.di-tokens';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';
import { CacheProvider } from './infrastructure/cache.provider';

container.register(AGENT_RUN_REPOSITORY, AgentRunRepository, {
  lifecycle: Lifecycle.Singleton,
});

// CachePort 实现回归端口所有者（agent）；消费者按 CACHE_PORT 注入。
container.register(CACHE_PORT, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});

import './application/event/agent-run.handler';
import './application/event/cancel-run.handler';
import './application/query/get-run-view.handler';
import './application/query/get-child-runs.handler';
// config fragment 自注册——基础库不反向认识任何域。
import './application/service/model-config.fragment';
import './domain/model/loop-config.fragment';
