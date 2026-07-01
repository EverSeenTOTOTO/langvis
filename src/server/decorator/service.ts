import { singleton } from 'tsyringe';

/** service：语义化的 singleton 标记（领域 / 基础设施服务）。生命周期参与改用 @lifecycleHook 显式 opt-in。 */
export function service(): ClassDecorator {
  return function serviceDecorator(target: any) {
    singleton()(target);
  };
}
