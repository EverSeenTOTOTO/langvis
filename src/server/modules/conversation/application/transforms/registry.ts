import { container } from 'tsyringe';
import type { ConvTransform } from '@/server/modules/conversation/domain/model/conv-transform';

/**
 * conv transform 的共享 DI token：所有 @convTransform 类在此 token 下多注册，
 * resolveConvTransforms 用 resolveAll 取全部——容器即 registry，无模块级数组。
 */
export const CONV_TRANSFORM = Symbol('CONV_TRANSFORM');

/**
 * 纯标记装饰器：把 ConvTransform 类在 CONV_TRANSFORM token 下注册（useToken → 复用类的 @singleton 注册）。
 * 类自带 @singleton/@injectable；本装饰器只登记，可叠加。
 */
export function convTransform<T extends new (...args: any[]) => ConvTransform>(
  target: T,
): T {
  container.register(CONV_TRANSFORM, { useToken: target });
  return target;
}

/** 解析所有 @convTransform 登记的 transform（经容器，保 singleton 语义）。 */
export function resolveConvTransforms(): ConvTransform[] {
  return container.resolveAll<ConvTransform>(CONV_TRANSFORM);
}
