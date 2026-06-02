import { container, Lifecycle } from 'tsyringe';
import {
  MEMORY_SERVICE,
  CACHE_PORT,
  LLM_PORT,
  TOOL_RESOLVER,
} from './agent.di-tokens';
import { MemoryService } from '@/server/modules/memory/domain/memory-service';
import { CacheService } from '@/server/modules/memory/adapters/cache.adapter';
import { LlmService } from '@/server/modules/memory/adapters/llm.adapter';
import { ContainerToolResolver } from './tool-resolver.impl';

// Register MemoryService as a singleton under the MEMORY_SERVICE token
container.register(MEMORY_SERVICE, MemoryService, {
  lifecycle: Lifecycle.Singleton,
});

// Use string tokens to map port → existing service registrations
container.register(CACHE_PORT, CacheService);
container.register(LLM_PORT, LlmService);

// ToolResolver: wraps container.resolve for domain entity use
container.register(TOOL_RESOLVER, ContainerToolResolver);
