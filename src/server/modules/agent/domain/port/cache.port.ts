/**
 * CachePort —— 大内容无损落盘契约（写端）。消费者拥有端口，agent 实现并经 CACHE_PORT 注入。
 * 落盘件只供 bash rg/sed/head 检索或归档工具 rawFile 读。
 */

/** offload 产出的桩引用对象；读端按 $cached 文件名经 bash 检索盘上件。 */
export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
  /** 语义标签（tool + 关键入参 + 形状），供 LLM 不读正文即判断该不该 page-in。 */
  $label?: string;
}

export interface CachePort {
  /**
   * 始终写盘返桩（force）。预算化 offload（pre-LLM / post-observation hook）用它把大 user 消息载荷
   * （Observation 或裸 user，如 email 正文）无损落盘。hint 进文件名 + $label，让 LLM
   * 凭桩即知内容、用 bash rg/sed/head 检索。
   */
  offload(
    workDir: string,
    value: unknown,
    hint?: string,
  ): Promise<CachedReference>;
}
