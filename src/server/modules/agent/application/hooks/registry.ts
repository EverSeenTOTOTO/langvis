import { container, injectable } from 'tsyringe';
import type { Hook } from '@/server/modules/agent/domain/model/hook';

/**
 * agent hook 的共享 DI token：所有 @agentHook 类在此 token 下多注册，
 * resolveAgentHooks 用 resolveAll 取全部——容器即 registry，无模块级数组。
 */
export const AGENT_HOOK = Symbol('AGENT_HOOK');

/**
 * 内置 @injectable() 的标记装饰器：把 Hook 类在 AGENT_HOOK token 下注册（useClass → 每次 resolve 新实例）。
 * 类上只需挂这一个装饰器（镜像 decorator/controller.ts 的 controller 装饰器）。
 *
 * hook 非 singleton、per-run 实例化：executor 的 createRun 每次 run 调一次 resolveAgentHooks，
 * 故 hook 可把跨 tick 的私有状态内聚在实例字段（如 BudgetHook 的累计 token），既不污染 ctx，
 * 又从构造上杜绝跨 run 共享可变状态的并发污染。跨 run 的持久状态仍走 repo，不进实例字段。
 */
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
