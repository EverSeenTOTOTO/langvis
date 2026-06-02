import { container, Lifecycle } from 'tsyringe';
import { MEMORY_SERVICE, AGENT_RUN_FACTORY } from './agent.di-tokens';
import { MemoryService } from '@/server/modules/memory/domain/memory-service';
import { AgentRunFactory } from './application/agent-run.factory';

container.register(MEMORY_SERVICE, MemoryService, {
  lifecycle: Lifecycle.Singleton,
});

container.register(AGENT_RUN_FACTORY, AgentRunFactory);
