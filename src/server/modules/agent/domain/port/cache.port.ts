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
  /** 语义标签（tool + 关键入参 + 形状），供 LLM 不读正文即判断该不该 page-in。 */
  $label?: string;
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
    hint?: string,
  ): Promise<unknown>;
  readFile(
    workDir: string,
    filename: string,
    offset?: number,
    limit?: number,
  ): Promise<string | Record<string, unknown>>;
  /**
   * 始终写盘返桩（force），与 compress（按阈值/strategy 决定压不压）的区别在此。
   * 预算化 offload（post-observation hook）用它把老 Observation 载荷无损落盘。
   * hint 进文件名 + $label，让 LLM 凭桩即知内容、用 rg/cached_read 检索。
   */
  offload(
    workDir: string,
    value: unknown,
    hint?: string,
  ): Promise<CachedReference>;
}
