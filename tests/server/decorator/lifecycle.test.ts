import { container } from 'tsyringe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { service } from '@/server/decorator/service';
import {
  lifecycleHook,
  bootAll,
  shutdownAll,
} from '@/server/decorator/lifecycle';

// hooks 集合在文件内 it 间累积——每个用例只断言自身 fn（在其首次被调用的当下恰好 1 次）。
describe('lifecycle aspect', () => {
  beforeEach(() => {
    container.reset();
  });

  it('bootAll 调用 @lifecycleHook 的 onBoot', async () => {
    const onBoot = vi.fn().mockResolvedValue(undefined);
    @service()
    @lifecycleHook
    class BootHook {
      onBoot = onBoot;
    }
    void BootHook;

    await bootAll();
    expect(onBoot).toHaveBeenCalledTimes(1);
  });

  it('shutdownAll 调用 @lifecycleHook 的 onShutdown', async () => {
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    @service()
    @lifecycleHook
    class ShutdownHook {
      onShutdown = onShutdown;
    }
    void ShutdownHook;

    await shutdownAll();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('未标 @lifecycleHook 的类不参与（opt-in）', async () => {
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    @service()
    class NotAHook {
      onShutdown = onShutdown;
    }
    void NotAHook;

    await shutdownAll();
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it('单个 hook 抛错则整个 phase reject（fail-fast，不容忍环境缺陷）', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    @service()
    @lifecycleHook
    class FailingHook {
      onShutdown = vi.fn().mockRejectedValue(new Error('boom'));
    }
    @service()
    @lifecycleHook
    class OkHook {
      onShutdown = ok;
    }
    void FailingHook;
    void OkHook;

    await expect(shutdownAll()).rejects.toThrow('boom');
    // fail-fast：FailingHook 先注册先抛，OkHook 不再执行
    expect(ok).not.toHaveBeenCalled();
  });

  it('缺省 onBoot/onShutdown 不报错（鸭子类型跳过）', async () => {
    @service()
    @lifecycleHook
    class EmptyHook {}
    void EmptyHook;

    await expect(bootAll()).resolves.toBeUndefined();
    await expect(shutdownAll()).resolves.toBeUndefined();
  });
});
