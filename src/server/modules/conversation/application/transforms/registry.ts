import { container, singleton } from 'tsyringe';
import type { ConvTransform } from '@/server/modules/conversation/domain/model/conv-transform';

/**
 * conv transform 的共享 DI token：所有 @convTransform 类在此 token 下多注册，
 * resolveConvTransforms 用 resolveAll 取全部——容器即 registry，无模块级数组。
 */
export const CONV_TRANSFORM = Symbol('CONV_TRANSFORM');

/**
 * 内置 @singleton() 的标记装饰器：把 ConvTransform 类注册为 singleton，
 * 并在 CONV_TRANSFORM token 下登记（useToken → 复用 singleton 实例）。
 * 类上只需挂这一个装饰器（镜像 decorator/controller.ts 的 controller 装饰器）。
 */
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
