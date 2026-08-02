import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';
import type { DomainEvent } from './domain-event.base';

@singleton()
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // 统一领域事件分发入口，取代裸 emit(eventType, event)。可观测性走各 handler 日志与 RunEvent 投影流，不在此逐条记。
  dispatch(eventType: string, event: DomainEvent): void {
    this.emit(eventType, event);
  }
}
