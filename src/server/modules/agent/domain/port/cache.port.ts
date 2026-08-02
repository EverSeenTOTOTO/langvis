// CachePort —— 大内容无损落盘契约（写端）。落盘件只供 bash rg/sed/head 检索或归档 rawFile 读。

/** offload 产出的桩引用对象；读端按 $cached 文件名经 bash 检索盘上件。 */
export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
  /** 语义标签（tool + 关键入参 + 形状），供 LLM 不读正文即判断该不该 page-in。 */
  $label?: string;
}

export interface CachePort {
  // 始终写盘返桩（force）。预算化 offload 把大 user 载荷无损落盘，hint 进文件名 + $label 供 LLM 凭桩检索。
  offload(
    workDir: string,
    value: unknown,
    hint?: string,
  ): Promise<CachedReference>;
}
