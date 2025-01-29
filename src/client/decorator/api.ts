import { getOwnPropertyNames, isClient } from '@/shared/constants';
import { message } from 'antd';

const metaDataKey = Symbol('client_api');

export type ApiResponse<T extends Record<string, any> = {}> = {
  error?: any;
  data?: T;

  [k: string]: any;
};

type Config = {
  path: string;
  options?: RequestInit & { timeout?: number };
};

export type ApiOptions<P> =
  | string
  | ((req: P) => string)
  | Config
  | ((req: P) => Config);

export function api<P = Record<string, any>>(
  config: ApiOptions<P>,
): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, config, target, propertyKey);
  };
}

const logError = (error: any) => {
  if (isClient()) {
    message.error(error.message);
  } else {
    console.error(error.stack || error.message);
  }
};

export function wrapApi<P, T extends Record<string, any>, R>(
  fn: (req: P, res?: ApiResponse<T>) => R,
  config: string | ApiOptions<P>,
) {
  return async (req: P) => {
    try {
      const { path, options } =
        typeof config === 'string'
          ? { path: config }
          : typeof config === 'function'
            ? (() => {
                const path = config(req);

                return typeof path === 'string' ? { path } : path;
              })()
            : config;

      const url =
        path.startsWith('/') && !isClient()
          ? `http://localhost:${import.meta.env.VITE_PORT}${path}`
          : path;
      const timeout = options?.timeout || 10_000;

      const res = await Promise.race([
        fetch(url, options),
        new Promise<Error>(resolve => {
          setTimeout(
            () => resolve(new Error(`Request timeout: ${url}`)),
            timeout,
          );
        }),
      ]);

      if (res instanceof Error) {
        logError(res);

        return fn(req, { error: res.message });
      }

      const rsp = await res.json();

      if (res.status < 200 || res.status >= 300) {
        logError(new Error(`Response error: ${url}: ${rsp?.error}`));
      }

      return fn(req, rsp);
    } catch (error) {
      logError(new Error(`Request error. ${(error as Error)?.message}`));

      return fn(req, { error: (error as Error)?.message });
    }
  };
}

export default function <T extends Record<string, any>>(instance: T) {
  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (config) {
      Reflect.set(
        instance,
        prop,
        wrapApi(instance[prop].bind(instance), config),
      );
    }
  });

  return instance;
}
