import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { ToolIds } from '@/shared/constants';
import type { AuthorizationService } from '@/server/libs/infrastructure/authorization.service';
import { AuthorizationProvider } from '@/server/modules/agent/infrastructure/authorization.provider';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    callId: 'tc_1',
    input: {},
    signal: new AbortController().signal,
    workDir: '/tmp/workdir',
    conversationId: 'conv_1',
    llm: {} as never,
    auth: {} as never,
    runId: 'run_1',
    interactive: true,
    runtimeConfig: {},
    ...overrides,
  } as unknown as ToolCallContext;
}

function stubAuthService(): {
  service: Pick<AuthorizationService, 'hasGrant' | 'addGrant' | 'loadGrants'>;
  addGrant: ReturnType<typeof vi.fn>;
  hasGrant: ReturnType<typeof vi.fn>;
} {
  const hasGrant = vi.fn(async () => false);
  const addGrant = vi.fn(async () => undefined);
  const service = {
    hasGrant,
    addGrant,
    loadGrants: vi.fn(async () => new Set<string>()),
  };
  return { service: service as never, hasGrant, addGrant };
}

/** 注册一个伪 AskUser：yield 无事件、返回 { submitted, data }。 */
function registerFakeAskUser(result: {
  submitted: boolean;
  data: Record<string, unknown>;
}): void {
  const fake = {
    call: async function* (): AsyncGenerator<
      RunEvent,
      { submitted: boolean; data: Record<string, unknown> },
      void
    > {
      return result;
    },
  };
  container.registerInstance(ToolIds.ASK_USER, fake as never);
}

async function collect<R>(gen: AsyncGenerator<RunEvent, R, void>): Promise<R> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

describe('AuthorizationProvider', () => {
  beforeEach(() => {
    container.reset();
  });

  it('hasGrant 命中 → 直接 return（不调 AskUser、不 addGrant）', async () => {
    const { service, hasGrant, addGrant } = stubAuthService();
    hasGrant.mockResolvedValue(true);
    const provider = new AuthorizationProvider(service as never);

    const gen = provider.ensureApproved(makeCtx(), 'read-path', '/etc', {
      prompt: 'p',
      formSchema: {},
    });
    const ret = await collect(gen);
    expect(ret).toBeUndefined();
    expect(addGrant).not.toHaveBeenCalled();
  });

  it('非 interactive → 抛（不调 AskUser）', async () => {
    const { service } = stubAuthService();
    const provider = new AuthorizationProvider(service as never);

    const gen = provider.ensureApproved(
      makeCtx({ interactive: false }),
      'exec-cmd',
      'bash:abc',
      { prompt: 'p', formSchema: {} },
    );
    await expect(collect(gen)).rejects.toThrow(/non-interactive/);
  });

  it('allow → addGrant 被调 + 返 AskUser data', async () => {
    const { service, addGrant } = stubAuthService();
    registerFakeAskUser({
      submitted: true,
      data: { confirmed: true, timeout: 30 },
    });
    const provider = new AuthorizationProvider(service as never);

    const gen = provider.ensureApproved(makeCtx(), 'exec-cmd', 'bash:abc', {
      prompt: 'p',
      formSchema: {},
    });
    const ret = (await collect(gen)) as Record<string, unknown> | undefined;
    expect(addGrant).toHaveBeenCalledWith('conv_1', 'exec-cmd:bash:abc');
    expect(ret?.timeout).toBe(30);
  });

  it('deny → 抛（不 addGrant）', async () => {
    const { service, addGrant } = stubAuthService();
    registerFakeAskUser({
      submitted: true,
      data: { confirmed: false, remark: 'nope' },
    });
    const provider = new AuthorizationProvider(service as never);

    const gen = provider.ensureApproved(makeCtx(), 'exec-cmd', 'bash:abc', {
      prompt: 'p',
      formSchema: {},
    });
    await expect(collect(gen)).rejects.toThrow(/拒绝授权/);
    expect(addGrant).not.toHaveBeenCalled();
  });
});
