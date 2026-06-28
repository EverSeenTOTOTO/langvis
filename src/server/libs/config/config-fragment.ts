import type { JSONSchemaType } from 'ajv';

/**
 * ConfigFragment —— 一个域对「对话配置」的自描述贡献（schema + 读取器，双向闭环）。
 *
 * 自下而上（注册）：各域声明顶层键与 schema 片段，AgentService 按 key 平铺进 configSchema，
 * 前端 SchemaField 据此渲染配置弹窗。默认值唯一来源是 schema 内的 `default` 关键字
 * （嵌套可空容器须带对象级 `default`，如 `default: {}`，否则 ajv 不建嵌套对象、叶子默认值不生效）。
 *
 * 自上而下（读取）：各域声明 `read`，从已 parse 的 runtimeConfig 取回本域强类型配置。
 * 消费方统一走 `readConfigFragment<T>(key, cfg)`，不再各自 ad-hoc 硬转。
 */
export interface ConfigFragment<TRead = unknown> {
  /** 顶层命名空间键，全局唯一：'memory' | 'upload' | 'model' | … */
  readonly key: string;
  /** configSchema.properties[key] 的 schema 片段。 */
  readonly schema: JSONSchemaType<unknown>;
  /** 从已 parse 的 runtimeConfig 取回本域强类型配置（parse() 已依 schema default 建好结构）。 */
  readonly read: (runtimeConfig: Record<string, unknown>) => TRead;
}

const REGISTRY: ConfigFragment[] = [];

/** 注册一个 fragment 并原样返回——定义、注册、导出一步完成。重复 key 抛错。 */
export const defineConfigFragment = <F extends ConfigFragment>(
  fragment: F,
): F => {
  if (REGISTRY.some(f => f.key === fragment.key)) {
    throw new Error(`Duplicate ConfigFragment key: '${fragment.key}'`);
  }
  REGISTRY.push(fragment);
  return fragment;
};

export const getConfigFragments = (): readonly ConfigFragment[] => REGISTRY;

/**
 * 自上而下读取：按 key 查注册表调对应 fragment 的 `read`，返回强类型配置。
 * 未知 key fail loud（invariant 违例）。消费方以此取代散落的 `cfg.xxx` 硬转。
 */
export const readConfigFragment = <T>(
  key: string,
  runtimeConfig: Record<string, unknown>,
): T => {
  const fragment = REGISTRY.find(f => f.key === key);
  if (!fragment) {
    throw new Error(`Unknown ConfigFragment key: '${key}'`);
  }
  return fragment.read(runtimeConfig) as T;
};
