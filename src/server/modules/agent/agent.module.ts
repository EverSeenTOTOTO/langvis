import { container, Lifecycle } from 'tsyringe';
import { CACHE_SERVICE, AGENT_RUN_REPOSITORY } from './agent.di-tokens';
import { CacheProvider } from '@/server/modules/memory/infrastructure/cache.provider';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';

container.register(CACHE_SERVICE, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});
container.register(AGENT_RUN_REPOSITORY, AgentRunRepository, {
  lifecycle: Lifecycle.Singleton,
});

import './application/event/agent-run.handler';
