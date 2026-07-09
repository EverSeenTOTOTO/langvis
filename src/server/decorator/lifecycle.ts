import { container } from 'tsyringe';

/**
 * 生命周期切面：把"启动 / 关停"做成一对可插拔的连接点。
 *
 * 任何 singleton 想参与启停，实现 LifecycleHook 的 onBoot/onShutdown（均可选），
 * 并叠加 @lifecycleHook 标记即可——bootAll()/shutdownAll() 经 resolveAll 解析后按鸭子类型调用。
 *
 * 失败语义：hook 抛错视为环境缺陷（依赖缺失、基础设施未就绪等），fail-fast——
 * 整个 phase reject、不静默吞掉。空 registry（无 hook）则 no-op（非缺陷）。
 */
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
