// 领域事件基接口。不依赖 EventEmitter——聚合根只收集，发布时机由调用方控制（见 aggregate-root）。
export interface DomainEvent<
  TType extends string = string,
  TPayload = unknown,
> {
  readonly type: TType;
  readonly occurredAt: number;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

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
