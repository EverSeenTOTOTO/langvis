import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';
import type { DomainEvent } from './domain-event.base';
import Logger from '@/server/utils/logger';

const busLog = Logger.child({ source: 'Bus' });

@singleton()
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** 统一领域事件分发入口（带日志），取代裸 emit(eventType, event)。 */
  dispatch(eventType: string, event: DomainEvent): void {
    busLog.info(`Event ${eventType}`, {
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
    });
    this.emit(eventType, event);
  }
}
