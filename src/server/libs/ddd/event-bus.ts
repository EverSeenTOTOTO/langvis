import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';
import Logger from '@/server/utils/logger';

@singleton()
export class EventBus extends EventEmitter {
  private readonly logger = Logger.child({ source: 'EventBus' });

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  override emit(event: string, ...args: any[]): boolean {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      Promise.resolve()
        .then(() => (listener as (...a: unknown[]) => void)(...args))
        .catch(err => {
          this.logger.error(`Event handler failed for "${event}"`, err);
        });
    }
    return listeners.length > 0;
  }
}
