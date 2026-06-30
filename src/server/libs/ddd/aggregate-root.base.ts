import type { DomainEvent } from './domain-event.base';
import { Entity } from './entity.base';

/**
 * AggregateRoot — 聚合根基类（参考 domain-driven-hexagon）。
 *
 * 聚合根内部通过 addEvent 收集领域事件，应用服务/Repository 在持久化后读取并发布
 * （domainEvents → clearEvents），由此控制发布时机、保证事件只在持久化成功后落地。
 */
export abstract class AggregateRoot<TId> extends Entity<TId> {
  private _domainEvents: DomainEvent[] = [];

  constructor(id: TId) {
    super(id);
  }

  get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  protected addEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  clearEvents(): void {
    this._domainEvents = [];
  }
}
