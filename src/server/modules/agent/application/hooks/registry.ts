import { container, injectable } from 'tsyringe';
import type { Hook } from '@/server/modules/agent/domain/model/hook';

// agent hook 共享 DI token：所有 @agentHook 在此 token 下多注册，resolveAgentHooks 用 resolveAll 取全部。
export const AGENT_HOOK = Symbol('AGENT_HOOK');

// 标记装饰器（镜像 controller 装饰器）：@injectable + 在 AGENT_HOOK token 下 useClass 注册（每次 resolve 新实例）。
// hook 非 singleton、per-run：跨 tick 私有状态可内聚实例字段（如累计 token）；跨 run 持久状态仍走 repo。
export function agentHook<T extends new (...args: any[]) => Hook>(
  target: T,
): T {
  injectable()(target);
  container.register(AGENT_HOOK, { useClass: target });
  return target;
}

/** 解析所有 @agentHook 登记的 hook（每次调用均构造新实例——per-run）。 */
export function resolveAgentHooks(): Hook[] {
  return container.resolveAll<Hook>(AGENT_HOOK);
}
