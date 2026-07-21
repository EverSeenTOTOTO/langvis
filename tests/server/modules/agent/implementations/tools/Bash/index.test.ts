import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunEvent } from '@/shared/types/events';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { BashOutput } from '@/server/modules/agent/implementations/tools/Bash/config';

type RunChildOpts = { timeoutSec: number; signal: AbortSignal; callId: string };

// Mock bash-backend：不 spawn 真进程，仅记录传给 runChild 的 timeout。
const runChildMock = vi.fn<
  (
    handle: unknown,
    opts: RunChildOpts,
  ) => AsyncGenerator<RunEvent, BashOutput, void>
>(async function* () {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
});
vi.mock(
  '@/server/modules/agent/implementations/tools/Bash/bash-backend',
  () => ({
    DirectBash: class {
      spawn() {
        return { child: {}, kill: () => undefined };
      }
    },
    DockerBash: class {
      spawn() {
        return { child: {}, kill: () => undefined };
      }
    },
    runChild: runChildMock,
  }),
);

const { default: BashTool } = await import(
  '@/server/modules/agent/implementations/tools/Bash'
);

function makeCtx(
  input: Record<string, unknown>,
  auth: AuthorizationPort,
): ToolCallContext {
  return {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir: '/tmp/workdir',
    conversationId: 'conv_1',
    llm: {} as never,
    auth,
    runId: 'run_1',
    interactive: true,
    runtimeConfig: {},
  } as unknown as ToolCallContext;
}

function stubEnsureApproved(
  impl: () => AsyncGenerator<RunEvent, Record<string, unknown> | void, void>,
) {
  return vi.fn<
    (
      ctx: ToolCallContext,
      action: string,
      resource: string,
      opts: unknown,
    ) => AsyncGenerator<RunEvent, Record<string, unknown> | void, void>
  >(impl);
}

async function run(ctx: ToolCallContext): Promise<void> {
  const gen = new BashTool().call(ctx);
  let r = await gen.next();
  while (!r.done) r = await gen.next();
}

describe('BashTool interactive 授权门', () => {
  beforeEach(() => {
    runChildMock.mockClear();
  });

  it('safe（只读 + pwd 内）→ 不调 ensureApproved，用 suggestedTimeout', async () => {
    const ensureApproved = stubEnsureApproved(async function* () {
      throw new Error('should not be called');
    });
    const auth = { ensureApproved } as unknown as AuthorizationPort;
    await run(makeCtx({ command: 'ls', timeout: 30 }, auth));
    expect(ensureApproved).not.toHaveBeenCalled();
    expect(runChildMock).toHaveBeenCalledTimes(1);
    const opts = runChildMock.mock.calls[0]![1];
    expect(opts.timeoutSec).toBe(30);
  });

  it('sensitive（rm）→ 调 ensureApproved(exec-cmd, bash:*)，用返回 timeout', async () => {
    const ensureApproved = stubEnsureApproved(async function* () {
      return { confirmed: true, timeout: 42 };
    });
    const auth = { ensureApproved } as unknown as AuthorizationPort;
    await run(makeCtx({ command: 'rm ./a', timeout: 10 }, auth));
    expect(ensureApproved).toHaveBeenCalledTimes(1);
    const [ctxArg, action, resource] = ensureApproved.mock.calls[0]!;
    expect(ctxArg).toMatchObject({ conversationId: 'conv_1' });
    expect(action).toBe('exec-cmd');
    expect(String(resource).startsWith('bash:')).toBe(true);
    const opts = runChildMock.mock.calls[0]![1];
    expect(opts.timeoutSec).toBe(42);
  });

  it('sensitive 越界读（rg /etc）→ action read-path', async () => {
    const ensureApproved = stubEnsureApproved(async function* () {
      return { confirmed: true, timeout: 5 };
    });
    const auth = { ensureApproved } as unknown as AuthorizationPort;
    await run(makeCtx({ command: 'rg foo /etc', timeout: 5 }, auth));
    const [, action, resource] = ensureApproved.mock.calls[0]!;
    expect(action).toBe('read-path');
    expect(String(resource)).toBe('/etc');
  });
});
