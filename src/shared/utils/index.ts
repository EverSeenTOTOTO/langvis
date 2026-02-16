import { Message, Role } from '../entities/Message';

export const getOwnPropertyNames = <T extends object>(x: T) => {
  return [
    ...Object.getOwnPropertyNames(x),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(x)),
  ];
};

export const isClient = () => typeof document !== 'undefined';
export const isTest = () => import.meta.env.MODE === 'test';

export const isMessageLoading = (message?: Message): boolean => {
  if (!message || message.role !== Role.ASSIST) return false;
  const events = message.meta?.events ?? [];
  return !(events.some(e => e.type !== 'start') || message.content.length > 0);
};
