import { container, singleton } from 'tsyringe';
import type { ConvTransform } from '@/server/modules/conversation/domain/model/conv-transform';

// conv transform 的共享 DI token：容器即 registry，resolveConvTransforms 用 resolveAll 取全部。
export const CONV_TRANSFORM = Symbol('CONV_TRANSFORM');

// 标记装饰器：注册为 singleton 并在 CONV_TRANSFORM token 下登记（useToken 复用实例）。
export function convTransform<T extends new (...args: any[]) => ConvTransform>(
  target: T,
): T {
  singleton()(target);
  container.register(CONV_TRANSFORM, { useToken: target });
  return target;
}

/** 解析所有 @convTransform 登记的 transform（经容器，保 singleton 语义）。 */
export function resolveConvTransforms(): ConvTransform[] {
  return container.resolveAll<ConvTransform>(CONV_TRANSFORM);
}
