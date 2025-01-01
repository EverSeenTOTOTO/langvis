import { it, expect, vi } from 'vitest';
import factory, {
  wrapCatchGuard,
  catchGuard,
} from '@/client/decorator/catchGuard';

it('wrapCatchGuard sync', () => {
  expect(wrapCatchGuard(() => 42)()).toBe(42);

  try {
    wrapCatchGuard(() => {
      throw 42;
    });
  } catch (e) {
    expect(e).toBe(42);
  }

  const fn = vi.fn();

  expect(
    wrapCatchGuard(() => {
      throw 42;
    }, fn),
  ).not.toThrow();
  expect(fn).toHaveBeenCalledWith(42);
});

it('wrapCatchGuard async', async () => {
  expect(await wrapCatchGuard(async () => 42)()).toBe(42);

  try {
    await wrapCatchGuard(() => {
      throw 42;
    })();
  } catch (e) {
    expect(e).toBe(42);
  }

  const fn = vi.fn();

  await wrapCatchGuard(() => {
    throw 42;
  }, fn)();

  expect(fn).toHaveBeenCalledWith(42);
});

const action = vi.fn();

class Demo {
  @catchGuard(action)
  syncThrow() {
    throw 42;
  }

  @catchGuard(action)
  async asyncThrow() {
    throw 42;
  }

  @catchGuard(action)
  syncThrowMember = () => {
    throw 42;
  };

  @catchGuard(action)
  asyncThrowMember = async () => {
    throw 42;
  };
}

it('catchGuard', async () => {
  const demo = factory(new Demo());

  expect(demo.syncThrow).not.toThrow();
  expect(action).toHaveBeenCalledWith(42);

  expect(demo.syncThrowMember).not.toThrow();
  expect(action).toHaveBeenNthCalledWith(2, 42);

  expect(await demo.asyncThrow()).toBeUndefined();
  expect(action).toHaveBeenNthCalledWith(3, 42);

  expect(await demo.asyncThrowMember()).toBeUndefined();
  expect(action).toHaveBeenNthCalledWith(4, 42);
});
