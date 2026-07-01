import { container } from 'tsyringe';
import { describe, it, expect, beforeEach } from 'vitest';
import { service } from '@/server/decorator/service';

describe('service decorator', () => {
  beforeEach(() => {
    container.reset();
  });

  it('注册为 singleton', () => {
    @service()
    class TestService {}

    const a = container.resolve(TestService);
    const b = container.resolve(TestService);
    expect(a).toBe(b);
  });
});
