import { container, singleton } from 'tsyringe';
import { getHandlerFor } from '@/server/decorator/handler';
import type { Command } from './command.base';
import type { Query } from './query.base';

@singleton()
export class CommandBus {
  async execute<T = any>(command: Command): Promise<T> {
    const HandlerClass = getHandlerFor(
      command.constructor as abstract new (...args: any[]) => any,
    );
    if (!HandlerClass) {
      throw new Error(`No handler for ${command.constructor.name}`);
    }
    const handler = container.resolve<any>(HandlerClass as any);
    return handler.execute(command);
  }
}

@singleton()
export class QueryBus {
  async execute<T = any>(query: Query): Promise<T> {
    const HandlerClass = getHandlerFor(
      query.constructor as abstract new (...args: any[]) => any,
    );
    if (!HandlerClass) {
      throw new Error(`No handler for ${query.constructor.name}`);
    }
    const handler = container.resolve<any>(HandlerClass as any);
    return handler.execute(query);
  }
}
