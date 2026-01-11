import { ValidationException } from '@/shared/dto/base';
import { getOwnPropertyNames } from '@/shared/utils';
import { Express } from 'express';
import { extractParams } from './param';

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

      void app[(config.options?.method as 'get') || 'get'](
        path,
        async (req, res) => {
          try {
            const params = await extractParams(instance, prop, req, res);
            return await handle(...params);
          } catch (err) {
            const e = err as Error;

            if (e instanceof ValidationException) {
              req.log?.warn('Validation error:', e.toJSON());
              return res.status(400).json({
                error: 'Validation failed',
                details: e.toJSON().errors,
              });
            }

            req.log?.error(e.stack || e.message);
            return res.status(500).json({
              error: (e as Error).message || 'Internal Server Error',
            });
          }
        },
      );
    }
  });

  return instance;
}
