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

// Bash 执行后端不再经 DI 装配——BashTool 按 ctx.interactive 在 DirectBash（interactive）/ DockerBash（非 interactive）间 new。

import './application/event/agent-run.handler';
import './application/event/cancel-run.handler';
