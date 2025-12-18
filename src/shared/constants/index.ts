export const isAsyncFunction = <T, R>(fn: (...params: T[]) => R) =>
  toString.call(fn) === '[object AsyncFunction]';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
export const isTest = () => import.meta.env.MODE === 'test';
