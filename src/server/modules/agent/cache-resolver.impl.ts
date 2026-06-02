import { container } from 'tsyringe';
import type { CacheResolver } from './domain/cache-resolver.port';
import type { CachePort } from '@/server/modules/memory/ports/cache.port';
import { CACHE_PORT } from './agent.di-tokens';

export class ContainerCacheResolver implements CacheResolver {
  resolve(): CachePort {
    return container.resolve(CACHE_PORT);
  }
}
