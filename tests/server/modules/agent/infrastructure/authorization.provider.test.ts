import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ToolIds } from '@/shared/constants';
import { WorkspaceLocalStore } from '@/server/libs/infrastructure/workspace-local-store';
import { AuthorizationProvider } from '@/server/modules/agent/infrastructure/authorization.provider';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';

function makeCtx(
  workDir: string,
  overrides: Partial<ToolCallContext> = {},
): ToolCallContext {
  return {
    callId: 'tc_1',
    input: {},
    signal: new AbortController().signal,
    workDir,
    conversationId: 'conv_1',
    llm: {} as never,
    auth: {} as never,
    runId: 'run_1',
    interactive: true,
    runtimeConfig: {},
    ...overrides,
  } as unknown as ToolCallContext;
}

function registerFakeAskUser(result: {
  submitted: boolean;
  data: Record<string, unknown>;
}): { calls: number } {
  const tracker = { calls: 0 };
  const fake = {
    call: async function* (): AsyncGenerator<
      RunEvent,
      { submitted: boolean; data: Record<string, unknown> },
      void
    > {
      tracker.calls++;
      return result;
    },
  };
  container.registerInstance(ToolIds.ASK_USER, fake as never);
  return tracker;
}

async function collect<R>(gen: AsyncGenerator<RunEvent, R, void>): Promise<R> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

describe('AuthorizationProvider', () => {
  let workDir: string;
  let store: WorkspaceLocalStore;
  let provider: AuthorizationProvider;

  beforeEach(async () => {
    container.reset();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authprov-'));
    store = new WorkspaceLocalStore();
    provider = new AuthorizationProvider(store);
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('hasGrant 未命中 + allow → grants 写入 <workDir>/.langvis/grants.json', async () => {
    registerFakeAskUser({
      submitted: true,
      data: { confirmed: true, timeout: 30 },
    });

    const ret = (await collect(
      provider.ensureApproved(makeCtx(workDir), 'read-path', '/etc', {
        prompt: 'p',
        formSchema: {},
      }),
    )) as Record<string, unknown> | undefined;

    expect(ret?.timeout).toBe(30);
    const grants = await store.readSection<string[]>(workDir, 'grants');
    expect(grants).toContain('read-path:/etc');
  });

  it('hasGrant 命中 → 直接 return（不调 AskUser、不改文件）', async () => {
    await store.writeSection(workDir, 'grants', ['read-path:/etc']);
    const tracker = registerFakeAskUser({
      submitted: true,
      data: { confirmed: true },
    });

    const ret = await collect(
      provider.ensureApproved(makeCtx(workDir), 'read-path', '/etc', {
        prompt: 'p',
        formSchema: {},
      }),
    );

    expect(ret).toBeUndefined();
    expect(tracker.calls).toBe(0);
    const grants = await store.readSection<string[]>(workDir, 'grants');
    expect(grants).toEqual(['read-path:/etc']);
  });

  it('非 interactive → 抛（不调 AskUser）', async () => {
    const tracker = registerFakeAskUser({
      submitted: true,
      data: { confirmed: true },
    });

    await expect(
      collect(
        provider.ensureApproved(
          makeCtx(workDir, { interactive: false }),
          'exec-cmd',
          'bash:abc',
          { prompt: 'p', formSchema: {} },
        ),
      ),
    ).rejects.toThrow(/non-interactive/);
    expect(tracker.calls).toBe(0);
  });

  it('deny → 抛（不写 grants）', async () => {
    registerFakeAskUser({
      submitted: true,
      data: { confirmed: false, remark: 'nope' },
    });

    await expect(
      collect(
        provider.ensureApproved(makeCtx(workDir), 'exec-cmd', 'bash:abc', {
          prompt: 'p',
          formSchema: {},
        }),
      ),
    ).rejects.toThrow(/拒绝授权/);
    expect(await store.readSection(workDir, 'grants')).toBeNull();
  });

  it('grants 跨实例持久（文件即真相）', async () => {
    registerFakeAskUser({ submitted: true, data: { confirmed: true } });
    await collect(
      provider.ensureApproved(makeCtx(workDir), 'read-path', '/etc', {
        prompt: 'p',
        formSchema: {},
      }),
    );

    // 新 provider 实例应命中已落盘的 grant
    const tracker = registerFakeAskUser({
      submitted: true,
      data: { confirmed: true },
    });
    const fresh = new AuthorizationProvider(new WorkspaceLocalStore());
    const ret = await collect(
      fresh.ensureApproved(makeCtx(workDir), 'read-path', '/etc', {
        prompt: 'p',
        formSchema: {},
      }),
    );
    expect(ret).toBeUndefined();
    expect(tracker.calls).toBe(0);
  });
});
