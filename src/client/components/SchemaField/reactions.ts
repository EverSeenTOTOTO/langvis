// 响应式 schema 联动（reactions）：一条规则 = when 条件 + set 覆盖本字段的若干渲染状态；纯数据、可序列化，Ajv 忽略这些 UI 关键字。

/** 枚举项：原始值，或 { label, value }。 */
export type EnumItem =
  | string
  | number
  | boolean
  | { label: string; value: string | number | boolean };

// 条件 DSL：叶子引用 peer 字段做比较，可用 and/or/not 组合；field 路径相对 schema 根，由 namePrefix 解析。
export type Condition =
  | { field: string; op: 'eq' | 'ne'; value: unknown }
  | { field: string; op: 'in' | 'nin'; value: unknown[] }
  | { field: string; op: 'notEmpty' }
  | { field: string; op: 'matches'; pattern: string }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

// 一条响应式规则：`when` 成立时，用 `set` 覆盖本字段的若干状态。 多条规则按数组顺序求值，命中者依次合并（后者覆盖前者）。
export type SchemaReaction = {
  when: Condition;
  set: Partial<ReactiveFieldState>;
};

// 可被 reaction 动态覆盖的字段状态（均为渲染期元数据）。 新增联动维度时在此添加字段，渲染处从 effective prop 读取即可。
export type ReactiveFieldState = {
  /** 显隐；visible:false 时该字段不渲染（配合 preserve={false} 卸载其值）。 */
  visible?: boolean;
  /** 条件必填/选填；显式设值时覆盖静态 required。 */
  required?: boolean;
  /** 禁用控件。 */
  disabled?: boolean;
  /** 替换枚举选项（= Ant options）；收窄时渲染器会清掉不在新选项内的旧值。 */
  enum?: readonly EnumItem[];
  /** 覆盖 label。 */
  title?: string;
  /** 覆盖 tooltip/描述。 */
  description?: string;
};

/** 递归收集一组 reaction（含 `and`/`or`/`not`）引用到的所有 peer 字段名，去重。 */
export function collectFields(
  reactions: readonly SchemaReaction[] | undefined,
): string[] {
  const fields = new Set<string>();
  const walk = (cond: Condition): void => {
    if ('and' in cond) cond.and.forEach(walk);
    else if ('or' in cond) cond.or.forEach(walk);
    else if ('not' in cond) walk(cond.not);
    else fields.add(cond.field);
  };
  (reactions ?? []).forEach(r => walk(r.when));
  return [...fields];
}

/** 求值一个条件。`get(field)` 返回该 peer 字段当前表单值（可能 undefined）。 */
export function evalCond(
  cond: Condition,
  get: (field: string) => unknown,
): boolean {
  if ('and' in cond) return cond.and.every(c => evalCond(c, get));
  if ('or' in cond) return cond.or.some(c => evalCond(c, get));
  if ('not' in cond) return !evalCond(cond.not, get);

  const v = get(cond.field);
  switch (cond.op) {
    case 'eq':
      return v === cond.value;
    case 'ne':
      return v !== cond.value;
    case 'in':
      return cond.value.includes(v);
    case 'nin':
      return !cond.value.includes(v);
    case 'notEmpty':
      return v !== undefined && v !== null && v !== '';
    case 'matches':
      return typeof v === 'string' && new RegExp(cond.pattern).test(v);
    default:
      return false;
  }
}

// 把命中的 set 按数组顺序合并进 prop，返回新对象（不改入参）；无 reactions 时返回浅拷贝。
export function applyReactions<T extends object>(
  prop: T,
  reactions: readonly SchemaReaction[] | undefined,
  get: (field: string) => unknown,
): T {
  let effective = { ...prop } as T;
  for (const r of reactions ?? []) {
    if (evalCond(r.when, get)) effective = { ...effective, ...r.set } as T;
  }
  return effective;
}
