import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';

@singleton()
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}
