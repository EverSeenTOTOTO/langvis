import type { CompressionStrategy } from '@/server/service/CacheService';

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
