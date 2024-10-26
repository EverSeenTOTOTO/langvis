export const isAsyncFunction = <T, R>(fn: (...params: T[]) => R) =>
  toString.call(fn) === '[object AsyncFunction]';

export const getOwnPropertyNames = <T extends Object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};
