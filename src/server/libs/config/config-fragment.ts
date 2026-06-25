import type { JSONSchemaType } from 'ajv';

/**
 * ConfigFragment —— 一个域对「对话配置」的自描述贡献。
 *
 * 各域（memory / upload / model / …）各自声明其顶层配置键与 schema 片段，
 * AgentService 仅作聚合（按 key 平铺进 configSchema.properties），不再内联任何域的 schema。
 *
 * 默认值：schema 内的 `default` 关键字是唯一来源——前端 SchemaField 用它做 initialValue，
 * ajv `useDefaults` 在 parse 时回填。嵌套可空容器须带对象级 `default`（如 `default: {}`），
 * 否则 ajv 不会创建缺失的嵌套对象、叶子默认值不生效。
 */
export interface ConfigFragment {
  /** 顶层命名空间键，全局唯一：'memory' | 'upload' | 'model' | … */
  readonly key: string;
  /** configSchema.properties[key] 的 schema 片段。 */
  readonly schema: JSONSchemaType<unknown>;
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
