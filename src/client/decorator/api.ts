import { getOwnPropertyNames, isClient, isTest } from '@/shared/utils';
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
  const path = url.replace(/\?.*/, '');

  if (isFullPath(path)) {
    const parsedUrl = new URL(path);

    parsedUrl.pathname = compile(parsedUrl.pathname)(req);

    return `${parsedUrl.toString()}${query ? query[0] : ''}`;
  }

  return `${compile(path)(req)}${query ? query[0] : ''}`;
};

const getApiOptions = <P extends Record<string, any>>(
  req: P,
  {
    config,
    options,
  }: {
    config: ApiOptions<P>;
    options?: ApiConfig['options'];
  },
) => {
  if (typeof config === 'string') {
    return { path: compilePath(config, req), options };
  }

  if (typeof config === 'function') {
    const result = config(req);

    if (typeof result === 'string') {
      return {
        path: compilePath(result, req),
        options,
      };
    }

    return {
      path: compilePath(result.path, req),
      options: result.options || options,
    };
  }

  const { path } = config;

  return {
    path: compilePath(path, req),
    options: config.options,
  };
};

function isFileLike(value: unknown): boolean {
  return value instanceof File || value instanceof Blob;
}

function hasFiles(obj: unknown): boolean {
  if (isFileLike(obj)) return true;
  if (Array.isArray(obj)) return obj.some(isFileLike);
  if (obj && typeof obj === 'object') {
    return Object.values(obj).some(hasFiles);
  }
  return false;
}

function buildFormData(data: Record<string, any>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;

    if (isFileLike(value)) {
      formData.append(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, isFileLike(item) ? item : String(item));
      }
    } else {
      formData.append(key, String(value));
    }
  }

  return formData;
}

export class ApiRequest<P extends Record<string, any> = {}> extends Request {
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

    const shouldHaveBody = ['post', 'put', 'patch'].includes(
      options?.method || 'get',
    );

    let extraOptions: RequestInit | undefined;

    if (shouldHaveBody) {
      if (hasFiles(req)) {
        extraOptions = {
          body: buildFormData(req),
          signal: AbortSignal.timeout(options?.timeout || 60_000),
        };
      } else {
        extraOptions = {
          body: JSON.stringify(req),
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(options?.timeout || 60_000),
        };
      }
    }

    super(url, merge(options, extraOptions));
  }

  async send() {
    const fetchApi = isClient() ? fetch : serverFetch;

    const res = await fetchApi(this);

    if (res instanceof Error) {
      logError(res);

      throw res;
    }

    const rsp = await res.json();

    if (res.status < 200 || res.status >= 300) {
      const e = new Error(
        rsp?.error ?? `Response error: ${this.url} ${res.status}`,
      );

      logError(e);

      if (res.status === 401 && rsp?.redirect && isClient()) {
        window.location.href = rsp.redirect;
      }

      throw e;
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
  return async (params: P) => fn(params, new ApiRequest(params, config));
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
