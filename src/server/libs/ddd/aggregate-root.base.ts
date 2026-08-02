import type { DomainEvent } from './domain-event.base';
import { Entity } from './entity.base';

// 聚合根基类：内部 addEvent 收集领域事件，持久化成功后应用服务读取发布（domainEvents → clearEvents），保证事件只落成功后。
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
