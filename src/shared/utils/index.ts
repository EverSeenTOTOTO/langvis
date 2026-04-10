export * from './generateId';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
export const isTest = () => import.meta.env.MODE === 'test';

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const wrapUntrusted = (content: string): string =>
  `<untrusted_content>\n${content}\n</untrusted_content>`;

export const safeJsonParse = <T>(o: unknown, fallback?: T): T | null => {
  try {
    return JSON.parse(String(o)) as T;
  } catch {
    return fallback ?? null;
  }
};
