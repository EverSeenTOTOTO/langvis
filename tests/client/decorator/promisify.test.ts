import factory, {
  promisify,
  wrapPromisify,
} from '@/client/decorator/promisify';
import { expect, it } from 'vitest';

it('wrapPromisify', () => {
  expect(wrapPromisify(() => {})()).toBeInstanceOf(Promise);
  expect(wrapPromisify(async () => {})()).toBeInstanceOf(Promise);

  class Demo {
    syncThrow() {}

    async asyncThrow() {}

    syncThrowMember = () => {};

    asyncThrowMember = async () => {};
  }

  const demo = new Demo();

  expect(wrapPromisify(demo.syncThrow.bind(demo))()).toBeInstanceOf(Promise);
  expect(wrapPromisify(demo.asyncThrow.bind(demo))()).toBeInstanceOf(Promise);
  expect(wrapPromisify(demo.syncThrowMember.bind(demo))()).toBeInstanceOf(
    Promise,
  );
  expect(wrapPromisify(demo.asyncThrowMember.bind(demo))()).toBeInstanceOf(
    Promise,
  );
});

it('promisify', () => {
  class Demo {
    @promisify()
    syncThrow() {}

    @promisify()
    async asyncThrow() {}

    @promisify()
    syncThrowMember = () => {};

    @promisify()
    asyncThrowMember = async () => {};
  }

  const demo = factory(new Demo());

  expect(wrapPromisify(demo.syncThrow.bind(demo))()).toBeInstanceOf(Promise);
  expect(wrapPromisify(demo.asyncThrow.bind(demo))()).toBeInstanceOf(Promise);
  expect(wrapPromisify(demo.syncThrowMember.bind(demo))()).toBeInstanceOf(
    Promise,
  );
  expect(wrapPromisify(demo.asyncThrowMember.bind(demo))()).toBeInstanceOf(
    Promise,
  );
});
