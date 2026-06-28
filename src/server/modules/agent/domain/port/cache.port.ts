/**
 * CachePort —— 工具 I/O 压缩/缓存契约（agent 拥有：消费者定义端口）。
 *
 * CompressionStrategy / CachedReference / isCachedReference 一并置于本契约文件——
 * 它们是 cache 的对外语义，由 memory 的 CacheProvider 实现并经 CACHE_SERVICE 注入。
 * （此前这些类型散落在 memory 的 cache.provider 里，导致端口反向 import 实现的倒置。）
 */

/** 压缩策略：'file' 把大内容写入 workspace 临时文件、'skip' 原样返回。 */
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
