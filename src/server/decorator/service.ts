import { singleton } from 'tsyringe';
import { registerDisposableToken } from './disposal';

export function service(): ClassDecorator {
  return function serviceDecorator(target: any) {
    singleton()(target);
    registerDisposableToken(target);
  };
}
