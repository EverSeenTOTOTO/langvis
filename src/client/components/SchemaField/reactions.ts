/**
 * 响应式 schema 联动（reactions）—— 让一个字段的渲染状态随其它字段的取值动态变化。
 *
 * # 为什么是这个形态
 *
 * 早期形态是一族 `xxxIf` 关键字（visibleIf / enumIf / requiredIf …）：每多一种联动
 * 行为就要新增一个关键字，把「触发 / 目标属性 / 取值」三者钉死在一起，不利扩展。
 *
 * 这里把它泛化为**单一机制**：一条 reaction 只说两件事——
 *   - `when`：什么条件下生效（一个可组合的小条件 DSL，自带依赖字段名）。
 *   - `set` ：生效后覆盖本字段的哪些**字段状态**（见 `ReactiveFieldState`）。
 *
 * 于是「显隐」「条件必填」「换枚举选项」「查表换枚举」全是同一种规则，只是 `set` 不同：
 *   - 显隐         → set: { visible: false }
 *   - 条件必填     → set: { required: true }
 *   - 固定换枚举   → set: { enum: [...] }
 *   - 查表换枚举   → 多条同构规则（不同 when，各自 set.enum），无需 cases 特例。
 *                   例：「agent=react → 只能选 ReAct Memory」：
 *                     reactions: [
 *                       { when: { field: 'agent', op: 'eq', value: 'react' }, set: { enum: [REACT_MEM] } },
 *                       { when: { field: 'agent', op: 'eq', value: 'chat'  }, set: { enum: [CHAT_MEM] } },
 *                     ]
 * 新增一种联动维度 = 给 `ReactiveFieldState` 加一个可选字段 + 渲染处读它，不再加新关键字。
 *
 * # 纯数据、可序列化、无表达式引擎
 *
 * reactions 是纯数据（闭包无法跨 HTTP 传输：config schema 经 `/api/agent` 以 JSON 发到
 * 前端）。因此 `when` 用有限算子集（eq/ne/in/nin/notEmpty/matches + and/or/not）表达，
 * 而非任意 JS 表达式——覆盖真实联动需求，又不必引入求值器/沙箱。需要算术、字符串拼接
 * 或深级联时，再考虑升级到表达式串（Formily `x-reactions` 那条路）。
 *
 * # 与服务端校验的关系
 *
 * `reactions` 是 UI 语义，Ajv 忽略：config.ts 里 property 的额外关键字靠 ajv 的
 * `UncheckedJSONSchemaType` 末尾 `[keyword: string]: any` 索引签名通过编译，运行时
 * `strict:false` 忽略。需要服务端强约束时，在同一 `configSchema` 里用标准 JSON Schema
 * `if/then/else` 描述合法组合——Ajv 原生支持，与 UI 联动共存：
 *   UI 联动（reactions）管「体验」，if/then/else 管「权威校验」。
 */

/** 枚举项：原始值，或 { label, value }。 */
export type EnumItem =
  | string
  | number
  | boolean
  | { label: string; value: string | number | boolean };

/**
 * 条件 DSL。叶子引用一个 peer 字段并做比较；可用 `and` / `or` / `not` 组合。
 * `field` 路径相对 schema 根（顶层 properties），由渲染器的 namePrefix 解析。
 */
export type Condition =
  | { field: string; op: 'eq' | 'ne'; value: unknown }
  | { field: string; op: 'in' | 'nin'; value: unknown[] }
  | { field: string; op: 'notEmpty' }
  | { field: string; op: 'matches'; pattern: string }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

/**
 * 一条响应式规则：`when` 成立时，用 `set` 覆盖本字段的若干状态。
 * 多条规则按数组顺序求值，命中者依次合并（后者覆盖前者）。
 */
export type SchemaReaction = {
  when: Condition;
  set: Partial<ReactiveFieldState>;
};

/**
 * 可被 reaction 动态覆盖的字段状态（均为渲染期元数据）。
 * 新增联动维度时在此添加字段，渲染处从 effective prop 读取即可。
 */
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

/**
 * 把 reactions 折叠进 prop，返回 effective prop（新对象，不改入参）。
 * 命中的 `set` 按数组顺序合并，后者覆盖前者。无 reactions 时返回 prop 的浅拷贝。
 */
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
