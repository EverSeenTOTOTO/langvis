import { singleton } from 'tsyringe';

export function service(): ClassDecorator {
  return function serviceDecorator(target: any) {
    singleton()(target);
  };
}
