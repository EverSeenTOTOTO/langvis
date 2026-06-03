import { container, singleton } from 'tsyringe';
import { registerDisposableToken } from './disposal';
import { EventBus } from '@/server/libs/ddd/event-bus';
import type { Command } from '@/server/libs/ddd/command.base';
import type { Query } from '@/server/libs/ddd/query.base';
import Logger from '@/server/utils/logger';

const HANDLER_META = Symbol('ddd:handler');

export function commandHandler<T extends Command>(
  commandType: new (...args: any[]) => T,
): ClassDecorator {
  return (target: any) => {
    singleton()(target);
    registerDisposableToken(target);
    Reflect.defineMetadata(HANDLER_META, target, commandType);
  };
}

export function queryHandler<T extends Query>(
  queryType: new (...args: any[]) => T,
): ClassDecorator {
  return (target: any) => {
    singleton()(target);
    registerDisposableToken(target);
    Reflect.defineMetadata(HANDLER_META, target, queryType);
  };
}

export function eventHandler(eventType: string): ClassDecorator {
  return (target: any) => {
    singleton()(target);
    registerDisposableToken(target);
    const eventBus = container.resolve(EventBus);
    eventBus.on(eventType, async (...args: any[]) => {
      try {
        const handler = container.resolve<any>(target);
        await handler.handle(...args);
      } catch (err) {
        Logger.error(
          `Event handler [${target.name}] failed for "${eventType}"`,
          err,
        );
      }
    });
  };
}

export function getHandlerFor(
  target: abstract new (...args: any[]) => any,
): abstract new (...args: any[]) => any | undefined {
  return Reflect.getMetadata(HANDLER_META, target);
}
