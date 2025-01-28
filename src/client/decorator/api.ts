import { getOwnPropertyNames, isClient } from '@/shared/constants';
import { message } from 'antd';
import 'reflect-metadata';

const metaDataKey = Symbol('api');

export type ApiResponse = {
  error?: any;
  data?: any;
  status: number;

  [k: string]: any;
};

type ApiConfigBase = {
  path: string;
  options?: RequestInit & { timeout?: number };
};

export type ApiConfig<P> = ApiConfigBase | ((req: P) => ApiConfigBase);

export function api<P>(config: ApiConfig<P>): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, config, target, propertyKey);
  };
}

const errorLog = (error: any) => {
  if (isClient()) {
    message.error(error.message);
  } else {
    console.error(error.stack || error.message);
  }
};

export function wrapApi<P, R>(
  fn: (req: P, res?: ApiResponse) => R,
  config: ApiConfig<P>,
) {
  return async (req: P) => {
    try {
      const { path, options } =
        typeof config === 'function' ? config(req) : config;
      const url =
        path.startsWith('/') && !isClient()
          ? `http://localhost:${import.meta.env.VITE_PORT}${path}`
          : path;
      const timeout = options?.timeout || 10_000;

      const rsp = await Promise.race([
        fetch(url, options).then(res => res.json()),
        new Promise<Error>(resolve => {
          setTimeout(
            () => resolve(new Error(`Request timeout: ${url}`)),
            timeout,
          );
        }),
      ]);

      if (rsp instanceof Error) {
        errorLog(rsp);

        return fn(req, { status: 0, error: rsp });
      }

      if (rsp.status < 200 || rsp.status >= 300) {
        errorLog(new Error(`Response error: ${url}. ${rsp.error?.message}`));
      }

      return fn(req, rsp);
    } catch (error) {
      errorLog(new Error(`Request error. ${(error as Error)?.message}`));

      return fn(req, { status: 0, error });
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
