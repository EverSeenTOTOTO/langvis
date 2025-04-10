import { getOwnPropertyNames } from '@/shared/constants';
import { Express } from 'express';

const metaDataKey = Symbol('server_api');

export function api(
  path: string,
  options?: Pick<RequestInit, 'method'>,
): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, { path, options }, target, propertyKey);
  };
}

export default function <T extends Record<string, any>>(
  instance: T,
  namespace: string,
  app: Express,
) {
  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (config) {
      const handle = instance[prop].bind(instance);
      const path = `${namespace}${config.path}`;

      app[(config.options?.method as 'get') || 'get'](
        path,
        async (req, res) => {
          try {
            await handle(req, res);
          } catch (e) {
            console.error(e);
            res.status(500).json({
              error: 'Internal server error',
            });
          }
        },
      );
    }
  });

  return instance;
}

