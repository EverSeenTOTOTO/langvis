import { message } from 'antd';
import 'reflect-metadata';
import { getOwnPropertyNames, isClient } from '../constants';

const metaDataKey = Symbol('promisify');

export type ApiRequest = Record<string, any>;
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

export type ApiConfig = ApiConfigBase | ((req: ApiRequest) => ApiConfigBase);

export function api(config: ApiConfig): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, config, target, propertyKey);
  };
}

export function wrapApi<R>(
  fn: (req: ApiRequest, res?: ApiResponse) => R,
  config: ApiConfig,
) {
  return async (req: ApiRequest) => {
    try {
      const { path, options } =
        typeof config === 'function' ? config(req) : config;
      const url = typeof path === 'function' ? path : path;
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
        if (isClient()) message.error(rsp.message);

        return fn(req, { status: 0, error: rsp });
      }

      if (rsp.status < 200 || rsp.status >= 300) {
        if (isClient()) {
          message.error(`Response error: ${url}. ${rsp.error?.message}`);
        }
      }

      return fn(req, rsp);
    } catch (error) {
      if (isClient()) {
        message.error(`Request error. ${(error as Error)?.message}`);
      }
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
