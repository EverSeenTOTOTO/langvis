import { container } from 'tsyringe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { service, disposeAllServices } from '@/server/decorator/service';

describe('service decorator', () => {
  beforeEach(() => {
    container.reset();
  });

  it('should register service as singleton', () => {
    @service()
    class TestService {}

    const a = container.resolve(TestService);
    const b = container.resolve(TestService);
    expect(a).toBe(b);
  });

  it('should call dispose on services that implement it', async () => {
    const disposeFn = vi.fn().mockResolvedValue(undefined);

    @service()
    class DisposableService {
      dispose = disposeFn;
    }
    void DisposableService;

    await disposeAllServices();
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('should skip services without dispose method', async () => {
    @service()
    class PlainService {}
    void PlainService;

    await disposeAllServices();
  });

  it('should continue disposing other services when one fails', async () => {
    const dispose1 = vi.fn().mockRejectedValue(new Error('dispose failed'));
    const dispose2 = vi.fn().mockResolvedValue(undefined);

    @service()
    class FailingService {
      dispose = dispose1;
    }

    @service()
    class SucceedingService {
      dispose = dispose2;
    }
    void FailingService;
    void SucceedingService;

    await disposeAllServices();
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
  });

  it('should call dispose on multiple services', async () => {
    const dispose1 = vi.fn().mockResolvedValue(undefined);
    const dispose2 = vi.fn().mockResolvedValue(undefined);

    @service()
    class ServiceA {
      dispose = dispose1;
    }

    @service()
    class ServiceB {
      dispose = dispose2;
    }
    void ServiceA;
    void ServiceB;

    await disposeAllServices();
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
  });

  it('should skip services that fail to resolve', async () => {
    await disposeAllServices();
  });
});
