import type { CachePort } from '@/server/modules/memory/ports/cache.port';

export interface CacheResolver {
  resolve(): CachePort;
}
