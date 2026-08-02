import { container } from 'tsyringe';

// 生命周期切面：启停做成可插拔连接点。hook 抛错视为环境缺陷 fail-fast；空 registry no-op。
export interface LifecycleHook {
  onBoot?(): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}

/** lifecycle hook 的共享 DI token：所有 @lifecycleHook 类在此多注册，resolveAll 取全部。容器即 registry，无模块级数组。 */
const LIFECYCLE_HOOK = Symbol('LIFECYCLE_HOOK');

/** 纯标记：把一个类登记为生命周期参与方（useToken → 复用类的 DI 注册）。不组合 singleton——类自带给定 DI 装饰器，本装饰器只登记，可叠加。 */
export function lifecycleHook<T extends new (...args: any[]) => LifecycleHook>(
  target: T,
): T {
  container.register(LIFECYCLE_HOOK, { useToken: target });
  return target;
}

async function runPhase(phase: 'onBoot' | 'onShutdown'): Promise<void> {
  // 空 registry（无 hook）是 no-op，非缺陷——不抛。
  if (!container.isRegistered(LIFECYCLE_HOOK)) return;
  const hooks = container.resolveAll<LifecycleHook>(LIFECYCLE_HOOK);
  for (const hook of hooks) {
    const method = hook[phase];
    // 鸭子类型：hook 只参与它实现的 phase。方法缺失=跳过（非错误）；
    // 方法抛错=环境缺陷，向上传播、fail-fast（不 try/catch 吞掉）。
    if (typeof method === 'function') {
      await method.call(hook);
    }
  }
}

export const bootAll = (): Promise<void> => runPhase('onBoot');
export const shutdownAll = (): Promise<void> => runPhase('onShutdown');
