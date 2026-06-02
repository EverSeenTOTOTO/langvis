/**
 * DomainEvent — 领域事件基接口。
 *
 * 聚合根通过 addEvent() 收集，应用服务读取后发布。
 * 不引入 EventEmitter 依赖，发布时机由调用方控制。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/ for DDD phase context
 */
export interface DomainEvent<
  TType extends string = string,
  TPayload = unknown,
> {
  /** 事件类型标识（如 'run_completed', 'phase_changed'） */
  readonly type: TType;
  /** 发生时间戳 */
  readonly occurredAt: number;
  /** 所属聚合根 ID */
  readonly aggregateId: string;
  /** 事件载荷 */
  readonly payload: TPayload;
}

/**
 * 创建领域事件的工厂函数。
 * 使用泛型窄化 type 和 payload 类型。
 */
export function createDomainEvent<TType extends string, TPayload>(
  type: TType,
  aggregateId: string,
  payload: TPayload,
): DomainEvent<TType, TPayload> {
  return {
    type,
    occurredAt: Date.now(),
    aggregateId,
    payload,
  };
}
