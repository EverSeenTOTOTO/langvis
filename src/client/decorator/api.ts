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

export type ApiOptions = string | ApiConfig;

const logError = (msg: any) => {
  if (isTest()) return;

  console.error(msg);

  if (isClient()) {
    message.error(msg instanceof Error ? msg.message : String(msg));
  }
};

const isFullPath = (path: string) => /^https?:\/\//.test(path);

const compilePath = <P extends Record<string, any>>(url: string, req: P) => {
  const existingQuery = url.match(/\?.*/);
  const basePath = url.replace(/\?.*/, '');

  let compiledPath: string;
  let baseUrl: string;

  if (isFullPath(basePath)) {
    const parsedUrl = new URL(basePath);
    parsedUrl.pathname = compile(parsedUrl.pathname)(req);
    compiledPath = parsedUrl.pathname;
    baseUrl = parsedUrl.origin;
  } else {
    compiledPath = compile(basePath)(req);
    baseUrl = '';
  }

  // Collect params used in path template (e.g., :id)
  const usedKeys = new Set<string>();
  const tokenRegex = /:([^/]+)/g;
  let match;
  while ((match = tokenRegex.exec(basePath)) !== null) {
    usedKeys.add(match[1]);
  }

  // Append unused params as query string
  const extraParams = Object.entries(req ?? {})
    .filter(([key]) => !usedKeys.has(key) && req?.[key] !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');

  // Merge existing query with extra params
  const queryString = existingQuery
    ? extraParams
      ? `${existingQuery[0]}&${extraParams}`
      : existingQuery[0]
    : extraParams
      ? `?${extraParams}`
      : '';

  const fullPath = queryString ? `${compiledPath}${queryString}` : compiledPath;

  return baseUrl ? `${baseUrl}${fullPath}` : fullPath;
};

const getApiOptions = <P extends Record<string, any>>(
  req: P,
  {
    config,
    options,
  }: {
    config: ApiOptions;
    options?: ApiConfig['options'];
  },
) => {
  const path = typeof config === 'string' ? config : config.path;
  const resolvedOptions = typeof config === 'string' ? options : config.options;

  return {
    path: compilePath(path, req),
    options: resolvedOptions,
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
      config: ApiOptions;
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

export function api(
  config: ApiOptions,
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
    config: ApiOptions;
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
