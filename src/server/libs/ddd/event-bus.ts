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

  /**
   * Dispatch a domain event with logging.
   * Replaces raw emit(eventType, domainEvent) calls.
   */
  dispatch(eventType: string, event: DomainEvent): void {
    busLog.info(`Event ${eventType}`, {
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
    });
    this.emit(eventType, event);
  }
}
