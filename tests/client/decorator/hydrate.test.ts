import factory, { hydrate, wrapHydrate } from '@/client/decorator/hydrate';

it('wrapHydrate', () => {
  class Demo {
    foo = 42;
  }

  const demo = new Demo();

  const onHydrate = wrapHydrate(demo, 'foo');

  expect(onHydrate({})).toBe(42);
  expect(onHydrate({ foo: 0 })).toBe(0);

  const onHydrateProp = wrapHydrate(demo, 'foo', 'bar');

  expect(onHydrateProp({})).toBe(42);
  expect(onHydrateProp({ foo: 0 })).toBe(0);
  expect(onHydrateProp({ bar: 0 })).toBe(0);

  const onHydrateFn = wrapHydrate(demo, 'foo', state => state.bar);

  expect(onHydrateFn({})).toBe(undefined);
  expect(onHydrateFn({ foo: 0 })).toBe(undefined);
  expect(onHydrateFn({ bar: 0 })).toBe(0);
});

it('hydrate', () => {
  class Demo {
    @hydrate()
    foo = 0;

    @hydrate('foo')
    bar = 0;

    @hydrate(state => state.foo)
    baz = 0;
  }

  const demo = factory(new Demo());

  demo.hydrate({
    foo: 42,
  });

  expect(demo.foo).toBe(42);
  expect(demo.bar).toBe(42);
  expect(demo.baz).toBe(42);
  expect(demo.dehydra()).toEqual({
    foo: 42,
    bar: 42,
    baz: 42,
  });
});
