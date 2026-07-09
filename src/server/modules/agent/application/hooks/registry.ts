import { container } from 'tsyringe';
import type { Hook } from '@/server/modules/agent/domain/model/hook';

/**
 * agent hook 的共享 DI token：所有 @agentHook 类在此 token 下多注册，
 * resolveAgentHooks 用 resolveAll 取全部——容器即 registry，无模块级数组。
 */
export const AGENT_HOOK = Symbol('AGENT_HOOK');

/**
 * 纯标记装饰器：把 Hook 类在 AGENT_HOOK token 下注册（useToken → 复用类的 @singleton 注册，保 singleton 语义）。
 * 类自带 @singleton/@injectable；本装饰器只登记，可叠加。
 */
export function agentHook<T extends new (...args: any[]) => Hook>(
  target: T,
): T {
  container.register(AGENT_HOOK, { useToken: target });
  return target;
}

/** 解析所有 @agentHook 登记的 hook（经容器，保 singleton 语义）。 */
export function resolveAgentHooks(): Hook[] {
  return container.resolveAll<Hook>(AGENT_HOOK);
}
