import { container, Lifecycle } from 'tsyringe';
import { MEMORY_SERVICE } from './memory.di-tokens';
import { MemoryService } from './application/memory.service';

container.register(MEMORY_SERVICE, MemoryService, {
  lifecycle: Lifecycle.Singleton,
});
