import type { CompressionStrategy } from '@/server/modules/memory/services/cache.service';

export interface CachePort {
  resolve(conversationId: string, value: unknown): Promise<unknown>;
  compress(
    conversationId: string,
    value: unknown,
    strategy?: CompressionStrategy,
  ): Promise<unknown>;
  readFile(
    conversationId: string,
    filename: string,
    offset?: number,
    limit?: number,
  ): Promise<string | Record<string, unknown>>;
}
