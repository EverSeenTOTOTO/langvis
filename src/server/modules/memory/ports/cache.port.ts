import type { CompressionStrategy } from '@/server/modules/memory/adapters/cache.adapter';

export interface CachePort {
  compress(
    runId: string,
    output: unknown,
    strategy?: CompressionStrategy,
  ): Promise<unknown>;

  resolve(
    runId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
