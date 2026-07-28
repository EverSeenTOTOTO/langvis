import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';
import type { DomainEvent } from './domain-event.base';

@singleton()
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** 统一领域事件分发入口，取代裸 emit(eventType, event)。事件流可观测性走各 handler 自身日志 +
   *  RunEvent 投影流，不在此逐条记（原 info 仅 eventType+aggregateId，无有效载荷且高频）。 */
  dispatch(eventType: string, event: DomainEvent): void {
    this.emit(eventType, event);
  }
}
