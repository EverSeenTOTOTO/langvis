import { describe, it, expect, vi } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { OffloadHook } from '@/server/modules/agent/application/hooks/offload-hook';
import { OutputOffloadHook } from '@/server/modules/agent/application/hooks/output-offload-hook';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';

// 计数 parseResponse 调用——验证「每候选一次」契约（candidateBody 一次性解析，
// hint/stub/classifyRecall 复用，不重复 parse）。
let parseCalls = 0;
vi.mock('@/server/modules/agent/application/service/react-loop', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/modules/agent/application/service/react-loop')
  >('@/server/modules/agent/application/service/react-loop');
  return {
    ...actual,
    parseResponse: (content: string) => {
      parseCalls++;
      return actual.parseResponse(content);
    },
  };
});

// estimateTokens 用字符数代理（与 offload-hook.test 同手法）。
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: (msgs: { content?: string }[] | undefined) =>
    (msgs ?? []).reduce((s, m) => s + (m?.content?.length ?? 0), 0),
}));

async function collect(
  gen: AsyncGenerator<RunEvent, string>,
): Promise<{ events: RunEvent[] }> {
  const events: RunEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) break;
    events.push(r.value);
  }
  return { events };
}

function body(n: number): string {
  return 'x'.repeat(n);
}

function makeCtx(
  messages: LlmMessage[],
  opts: { offload: OffloadConfig | undefined },
): AgentRunContext {
  const cache: CachePort = {
    offload: vi.fn(async (_w: string, _v: unknown, hint?: string) => ({
      $cached: hint ? `sem__fc_test` : 'fc_test',
      $size: 600,
      $preview: '',
      ...(hint ? { $label: hint } : {}),
    })),
  };
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: { model: {}, offload: opts.offload },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: 0,
    messages: ListMonad.of<LlmMessage>(messages),
    config,
    cache,
  } as unknown as AgentRunContext;
}

const CFG = (): OffloadConfig => ({ windowRatio: 0.9 });
function offloadHook(contextSize: number): OffloadHook {
  return new OffloadHook({ resolveContextSize: () => contextSize } as never);
}

describe('offload parseResponse 调用计数（每候选一次：candidateBody 一次性解析，下游复用）', () => {
  it('assistant 候选：candidateBody 解析 1 次，hint/stub 复用 → 全程只 parse 1 次', async () => {
    parseCalls = 0;
    const ctx = makeCtx(
      [
        {
          role: 'assistant',
          content: JSON.stringify({
            thought: body(8000),
            tool: 'document_store',
            input: { document: { rawContent: 'big' } },
          }),
        },
      ],
      { offload: CFG() },
    );
    await collect(offloadHook(8192).apply(ctx));
    expect(ctx.cache.offload).toHaveBeenCalled(); // 确实桩了
    expect(parseCalls).toBe(1);
  });

  it('observation 候选：配对 assistant 仅 parse 1 次（classifyRecallParsed + hintForObservation 复用）', async () => {
    parseCalls = 0;
    const ctx = makeCtx(
      [
        {
          role: 'assistant',
          content: JSON.stringify({ tool: 'search', input: { q: 'a' } }),
        },
        { role: 'user', content: `Observation: ${body(8000)}` },
      ],
      { offload: CFG() },
    );
    await collect(offloadHook(8192).apply(ctx));
    expect(ctx.cache.offload).toHaveBeenCalled(); // 确实桩了
    expect(parseCalls).toBe(1); // 配对 assistant 一次，observation 本身不 parse
  });

  it('OutputOffloadHook：observation 配对 assistant 同样只 parse 1 次', async () => {
    parseCalls = 0;
    const ctx = makeCtx(
      [
        {
          role: 'assistant',
          content: JSON.stringify({
            tool: 'bash',
            input: { command: 'echo x' },
          }),
        },
        { role: 'user', content: `Observation: ${body(8000)}` },
      ],
      { offload: {} },
    );
    await collect(
      new OutputOffloadHook({
        resolveContextSize: () => 8000,
      } as never).apply(ctx),
    );
    expect(ctx.cache.offload).toHaveBeenCalled();
    expect(parseCalls).toBe(1);
  });
});
