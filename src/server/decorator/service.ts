import { container, singleton } from 'tsyringe';
import logger from '../utils/logger';

const serviceRegistry: any[] = [];

export function service(): ClassDecorator {
  return function serviceDecorator(target: any) {
    singleton()(target);
    serviceRegistry.push(target);
  };
}

/** Call dispose() on all registered services that implement it.
 *  Errors are logged but do not stop other services from being disposed. */
export async function disposeAllServices(): Promise<void> {
  for (const token of serviceRegistry) {
    try {
      const instance = container.resolve(token) as unknown as {
        dispose?: () => Promise<void>;
      };
      if (instance && typeof instance.dispose === 'function') {
        await instance.dispose();
      }
    } catch (err) {
      logger.error(`Failed to dispose service ${token.name}:`, err);
    }
  }
}
