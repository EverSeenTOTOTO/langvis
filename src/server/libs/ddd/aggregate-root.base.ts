import type { DomainEvent } from './domain-event.base';
import { Entity } from './entity.base';

/**
 * AggregateRoot — 聚合根基类。
 *
 * 参考 domain-driven-hexagon：聚合根收集领域事件（addEvent），
 * 应用服务/Repository 在持久化后读取并发布（domainEvents → clearEvents）。
 *
 * 用法：
 * ```typescript
 * class MyAggregate extends AggregateRoot<string> {
 *   doSomething() {
 *     // ... 业务逻辑
 *     this.addEvent(createDomainEvent('something_done', this.id, { detail }));
 *   }
 * }
 *
 * // 在应用服务中：
 * await repository.save(aggregate);
 * for (const event of aggregate.domainEvents) {
 *   eventBus.publish(event);
 * }
 * aggregate.clearEvents();
 * ```
 */
export abstract class AggregateRoot<TId> extends Entity<TId> {
  private _domainEvents: DomainEvent[] = [];

  constructor(id: TId) {
    super(id);
  }

  /** 当前收集的领域事件（只读） */
  get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  /** 收集领域事件。由聚合根内部方法调用。 */
  protected addEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /** 清空已收集的事件。由应用服务在发布后调用。 */
  clearEvents(): void {
    this._domainEvents = [];
  }
}
