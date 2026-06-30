import type { JSONSchemaType } from 'ajv';

/**
 * ConfigFragment —— 一个域对「对话配置」的自描述贡献（顶层键 + schema 片段）。
 *
 * 自下而上注册：各域声明顶层键与 schema 片段，AgentService 按 key 平铺进 configSchema 供前端渲染。
 * 默认值唯一来源是 schema 内的 `default` 关键字——嵌套可空容器须带对象级 `default`（如 `default: {}`），
 * 否则 ajv 不建嵌套对象、叶子默认值不生效。
 *
 * 读取方向无抽象：各域消费方直接从已 parse 的 runtimeConfig 取本域配置。曾经有 read/readConfigFragment
 * 一层，但注册表会把声明的返回类型擦除为 unknown（类型实际来自调用点泛型），对「自己读自己」无收益，故移除。
 */
export interface ConfigFragment {
  /** 顶层命名空间键，全局唯一：'history' | 'loop' | 'model' | … */
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

/**
 * 聚合所有已注册 fragment（按 key 平铺）为对话配置 schema。组合器不认识任何域细节——
 * AgentService 据此供前端渲染、ajv `useDefaults` 回填默认。
 */
export const composeConfigSchema = (): JSONSchemaType<unknown> =>
  ({
    type: 'object',
    properties: Object.fromEntries(
      getConfigFragments().map(f => [f.key, f.schema]),
    ),
  }) as unknown as JSONSchemaType<unknown>;
