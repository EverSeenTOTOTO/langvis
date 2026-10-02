export * from './generateId';
export * from './json';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
// import.meta.env 仅 Vite 加载路径存在（tsx/Node 直跑为 undefined）；NODE_ENV 在
// vitest（=test）与客户端构建（vite 静态替换 process.env.NODE_ENV）下语义等价。
export const isTest = () => process.env.NODE_ENV === 'test';

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const wrapUntrusted = (content: string): string =>
  `<untrusted_content>\n${content}\n</untrusted_content>`;

/** prompt 注入用的长格式日期（en-US，与 BASE_PROMPT 语言一致）。 */
export const formatToday = (): string =>
  new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export const safeJsonParse = <T>(o: unknown, fallback?: T): T | null => {
  try {
    return JSON.parse(String(o)) as T;
  } catch {
    return fallback ?? null;
  }
};
