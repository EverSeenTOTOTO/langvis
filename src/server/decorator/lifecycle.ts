import { container } from 'tsyringe';
import logger from '../utils/logger';

/**
 * 生命周期切面：把"启动 / 关停"做成一对可插拔的连接点。
 *
 * 任何 singleton 想参与启停，实现 LifecycleHook 的 onBoot/onShutdown（均可选），
 * 并叠加 @lifecycleHook 标记即可——bootAll()/shutdownAll() 解析后按鸭子类型调用。
 *
 * 清理（孤儿 run 清扫）、连接预热、后台任务启停等都是常见用例；
 * 整体退出不依赖任何单个 hook 成功——单个失败只 log，不阻断其余。
 */
export interface LifecycleHook {
  onBoot?(): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}

type LifecycleHookClass = new (...args: any[]) => LifecycleHook;

const hooks: LifecycleHookClass[] = [];

/** 纯标记：把一个类登记为生命周期参与方。不组合 singleton——类自带给定 DI 装饰器，本装饰器只登记，可叠加。 */
export function lifecycleHook<T extends NewableFunction>(target: T): T {
  hooks.push(target as unknown as LifecycleHookClass);
  return target;
}

async function runPhase(phase: 'onBoot' | 'onShutdown'): Promise<void> {
  for (const token of hooks) {
    try {
      const hook = container.resolve<LifecycleHook>(token);
      const method = hook[phase];
      if (typeof method === 'function') {
        await method.call(hook);
      }
    } catch (err) {
      logger.error(`Lifecycle ${phase} failed (${token.name}):`, err);
    }
  }
}

export const bootAll = (): Promise<void> => runPhase('onBoot');
export const shutdownAll = (): Promise<void> => runPhase('onShutdown');
