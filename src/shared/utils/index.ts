import { Message } from '../entities/Message';

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

export const sleepWithSignal = (
  ms: number,
  signal?: AbortSignal,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal!.reason);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const isMessageLoading = (message?: Message) => {
  if (!message) return false;
  const events = message.meta?.events ?? [];

  if (message.content.length > 0) return false;

  if (events.some(e => ['final', 'error'].includes(e.type))) return false;

  const hasSpecialEvents = events.some(
    e => !['start', 'final', 'error', 'stream'].includes(e.type),
  );
  if (hasSpecialEvents) return false;

  return true;
};
