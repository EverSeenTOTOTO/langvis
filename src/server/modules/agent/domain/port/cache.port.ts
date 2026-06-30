/**
 * CachePort —— 工具 I/O 压缩/缓存契约（消费者拥有端口，agent 实现并经 CACHE_SERVICE 注入）。
 */

/** 'file' 写入 workspace 临时文件；'skip' 原样返回。 */
export type CompressionStrategy = 'skip' | 'file';

/** 大内容被替换为此引用对象；cached_read 按 $cached 取回，整体传递时自动解析。 */
export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
}

export function isCachedReference(value: unknown): value is CachedReference {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    '$cached' in value &&
    typeof (value as CachedReference).$cached === 'string'
  );
}

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
