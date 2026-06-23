import type { CompressionStrategy } from '@/server/modules/memory/infrastructure/cache.provider';

export interface CachePort {
  resolve(workDir: string, value: unknown): Promise<unknown>;
  compress(
    workDir: string,
    value: unknown,
    strategy?: CompressionStrategy,
  ): Promise<unknown>;
  readFile(
    workDir: string,
    filename: string,
    offset?: number,
    limit?: number,
  ): Promise<string | Record<string, unknown>>;
}
