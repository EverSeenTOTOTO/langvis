import { container, Lifecycle } from 'tsyringe';
import { MEMORY_SERVICE, CACHE_PORT, LLM_PORT } from './agent.di-tokens';
import { MemoryService } from '@/server/modules/memory/domain/memory-service';
import { CacheService } from '@/server/service/CacheService';
import { LlmService } from '@/server/service/LlmService';

// Register MemoryService as a singleton under the MEMORY_SERVICE token
container.register(MEMORY_SERVICE, MemoryService, {
  lifecycle: Lifecycle.Singleton,
});

// Use string tokens to map port → existing service registrations
container.register(CACHE_PORT, CacheService);
container.register(LLM_PORT, LlmService);
