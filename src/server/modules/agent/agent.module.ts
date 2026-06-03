import { container, Lifecycle } from 'tsyringe';
import { MEMORY_SERVICE } from './agent.di-tokens';
import { MemoryService } from '@/server/modules/memory/domain/memory-service';

container.register(MEMORY_SERVICE, MemoryService, {
  lifecycle: Lifecycle.Singleton,
});
