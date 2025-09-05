import { getOwnPropertyNames, isClient, isTest } from '@/shared/constants';
import { message } from 'antd';
import fetchCookie from 'fetch-cookie';
import { merge } from 'lodash-es';
import { compile } from 'path-to-regexp';

const metaDataKey = Symbol('client_api');

export const serverFetch = fetchCookie(fetch);
export const getPrefetchPath = (path: string) =>
  `http://localhost:${import.meta.env.VITE_PORT}${path}`;

type ApiConfig = {
  path: string;
  options?: RequestInit & { timeout?: number };
};

export type ApiOptions<P> =
  | string
  | ((req: P) => string)
  | ApiConfig
  | ((req: P) => ApiConfig);

const logError = (msg: any) => {
  if (isTest()) return;

  console.error(msg);

  if (isClient()) {
    message.error(msg instanceof Error ? msg.message : String(msg));
  }
};

const isFullPath = (path: string) => /^https?:\/\//.test(path);

const compilePath = <P extends Record<string, any>>(url: string, req: P) => {
  const query = url.match(/\?.*/);
  const path = url.replace(/\?.*/, ''); // Remove query string for path-to-regexp

  if (isFullPath(path)) {
    const url = new URL(path);

    url.pathname = compile(url.pathname)(req);

    return `${url.toString()}${query ? query[0] : ''}`;
  }

  return `${compile(path)(req)}${query ? query[0] : ''}`;
};

const getApiOptions = <P extends Record<string, any>>(
  req: P,
  {
    config,
    options,
  }: { config: ApiOptions<P>; options?: ApiConfig['options'] },
) => {
  // @api('path')
  if (typeof config === 'string') {
    return { path: compilePath(config, req), options };
  }

  if (typeof config === 'function') {
    const result = config(req);

    // @api((req) => 'path')
    if (typeof result === 'string') {
      return { path: compilePath(result, req), options };
    }

    // @api((req) => ({ path: 'path', options: {} }))
    return {
      path: compilePath(result.path, req),
      options: result.options || options,
    };
  }

  // @api({ path: 'path', options: {} })
  const { path } = config;

  return {
    path: compilePath(path, req),
    options: config.options,
  };
};

export class ApiRequest<P extends Record<string, any> = {}> extends Request {
  readonly timeout?: number;

  constructor(
    req: P,
    config: {
      config: ApiOptions<P>;
      options?: ApiConfig['options'];
    },
  ) {
    const { path, options } = getApiOptions(req, config);
    const url =
      path.startsWith('/') && !isClient() ? getPrefetchPath(path) : path;
    const extraOptions = ['post'].includes(options?.method || 'get')
      ? {
          body: JSON.stringify(req),
          headers: { 'Content-Type': 'application/json' },
        }
      : undefined;

    super(url, merge(options, extraOptions));

    this.timeout = options?.timeout || 10_000;
  }

  async send() {
    const fetchApi = isClient() ? fetch : serverFetch;

    const res = await Promise.race([
      fetchApi(this),
      new Promise<Error>(resolve => {
        setTimeout(
          () => resolve(new Error(`Request timeout: ${this.url}`)),
          this.timeout,
        );
      }),
    ]);

    if (res instanceof Error) {
      logError(res);

      return { error: res.message };
    }

    const rsp = await res.json();

    if (res.status < 200 || res.status >= 300) {
      const e = new Error(
        rsp?.error ?? `Response error: ${this.url} ${res.status}`,
      );

      logError(e);

      return { error: e.message };
    }

    return rsp;
  }
}

export function api<P extends Record<string, any> = {}>(
  config: ApiOptions<P>,
  options?: ApiConfig['options'],
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

export function wrapApi<P extends Record<string, any>, R>(
  fn: (params: P, req: ApiRequest<P>) => R,
  config: {
    config: ApiOptions<P>;
    options?: ApiConfig['options'];
  },
) {
  return async (req: P) => {
    try {
      return await fn(req, new ApiRequest(req, config));
    } catch (e) {
      logError(e);
      return { error: (e as Error).message };
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
