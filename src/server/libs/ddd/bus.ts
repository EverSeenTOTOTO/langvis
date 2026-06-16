import { container, singleton } from 'tsyringe';
import { getHandlerFor } from '@/server/decorator/handler';
import type { Command } from './command.base';
import type { Query } from './query.base';
import Logger from '@/server/utils/logger';

const busLog = Logger.child({ source: 'Bus' });

@singleton()
export class CommandBus {
  async execute<T = any>(command: Command): Promise<T> {
    const type = command.constructor.name;
    const id = command.id;

    busLog.info(`Dispatching ${type}`, { id });

    const HandlerClass = getHandlerFor(
      command.constructor as abstract new (...args: any[]) => any,
    );
    if (!HandlerClass) {
      busLog.error(`No handler for ${type}`, { id });
      throw new Error(`No handler for ${type}`);
    }

    const handler = container.resolve<any>(HandlerClass as any);
    const start = Date.now();
    try {
      const result = await handler.execute(command);
      busLog.info(`${type} completed`, { id, duration: Date.now() - start });
      return result;
    } catch (err) {
      busLog.error(`${type} failed`, {
        id,
        duration: Date.now() - start,
        error: (err as Error)?.message ?? String(err),
      });
      throw err;
    }
  }
}

@singleton()
export class QueryBus {
  async execute<T = any>(query: Query): Promise<T> {
    const type = query.constructor.name;
    const id = query.id;

    busLog.info(`Dispatching ${type}`, { id });

    const HandlerClass = getHandlerFor(
      query.constructor as abstract new (...args: any[]) => any,
    );
    if (!HandlerClass) {
      busLog.error(`No handler for ${type}`, { id });
      throw new Error(`No handler for ${type}`);
    }

    const handler = container.resolve<any>(HandlerClass as any);
    const start = Date.now();
    try {
      const result = await handler.execute(query);
      busLog.info(`${type} completed`, { id, duration: Date.now() - start });
      return result;
    } catch (err) {
      busLog.error(`${type} failed`, {
        id,
        duration: Date.now() - start,
        error: (err as Error)?.message ?? String(err),
      });
      throw err;
    }
  }
}
