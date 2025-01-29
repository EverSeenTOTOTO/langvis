import 'reflect-metadata';

import factory, { hydrate, wrapHydrate } from '@/client/decorator/hydrate';
import { expect, it } from 'vitest';

it('wrapHydrate', () => {
  class Demo {
    foo = 42;
  }

  const demo = new Demo();

  const onHydrate = wrapHydrate(demo, 'foo');

  expect(onHydrate({})).toBe(42);
  expect(onHydrate({ foo: 0 })).toBe(0);
});

it('hydrate', () => {
  class Demo {
    @hydrate()
    foo = 0;
  }

  const demo = factory(new Demo());

  demo.hydrate({
    foo: 42,
  });

  expect(demo.foo).toBe(42);
  expect(demo.dehydra()).toEqual({
    foo: 42,
  });
});
