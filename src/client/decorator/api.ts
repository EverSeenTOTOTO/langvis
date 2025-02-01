import { getOwnPropertyNames, isClient } from '@/shared/constants';
import { message } from 'antd';
import { merge } from 'lodash-es';
import { compile } from 'path-to-regexp';

const metaDataKey = Symbol('client_api');

export type ApiResponse<T = Record<string, any>> = {
  error?: any;
  data?: T;

  [k: string]: any;
};

type Config = {
  path: string;
  options?: RequestInit & { timeout?: number };
};

export type ApiOptions<P> = string | Config | ((req: P) => Config);

export function api<P = Record<string, any>>(
  config: ApiOptions<P>,
  options?: Config['options'],
): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(
      metaDataKey,
      { config, options },
      target,
      propertyKey,
    );
  };
}

const logError = (error: any) => {
  if (isClient()) {
    message.error(error.message);
  } else {
    console.error(error.stack || error.message);
  }
};

const isFullPath = (path: string) => /^https?:\/\//.test(path);

const compilePath = <P extends Record<string, any>>(path: string, req: P) => {
  if (isFullPath(path)) {
    const url = new URL(path);

    url.pathname = compile(url.pathname)(req);

    return url.toString();
  }

  return compile(path)(req);
};

const getApiOptions = <P extends Record<string, any>>(
  req: P,
  {
    config,
    options,
  }: {
    config: ApiOptions<P>;
    options?: Config['options'];
  },
) => {
  if (typeof config === 'string') {
    return { path: compilePath(config, req), options };
  }

  if (typeof config === 'function') {
    const { path, options } = config(req);

    return {
      path: compilePath(path, req),
      options,
    };
  }

  const { path } = config;

  return {
    path: compilePath(path, req),
    options: config.options,
  };
};

export function wrapApi<
  P extends Record<string, any>,
  T extends Record<string, any>,
  R,
>(
  fn: (req: P, res?: ApiResponse<T>) => R,
  config: {
    config: ApiOptions<P>;
    options?: Config['options'];
  },
) {
  return async (req: P) => {
    try {
      const { path, options } = getApiOptions(req, config);

      const url =
        path.startsWith('/') && !isClient()
          ? `http://localhost:${import.meta.env.VITE_PORT}${path}`
          : path;
      const extraOptions = ['post'].includes(options?.method || 'get')
        ? {
            body: JSON.stringify(req),
            headers: { 'Content-Type': 'application/json' },
          }
        : undefined;
      const timeout = options?.timeout || 10_000;

      const res = await Promise.race([
        fetch(url, merge(options, extraOptions)),
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
        const e = new Error(rsp?.error ?? `Response error: ${url}`);

        logError(e);

        return fn(req, { error: e.message });
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
