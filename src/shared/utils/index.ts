import { Message } from '../entities/Message';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
export const isTest = () => import.meta.env.MODE === 'test';

export const isMessageLoading = (message?: Message) => {
  if (!message) return false;
  const events = message.meta?.events ?? [];
  return !(
    (events.length &&
      !events.some(e => ['start', 'final', 'error'].includes(e.type))) ||
    message.content.length > 0
  );
};
