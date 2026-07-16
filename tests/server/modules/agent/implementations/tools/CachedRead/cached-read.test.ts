import { describe, it, expect, vi } from 'vitest';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import CachedReadTool from '@/server/modules/agent/implementations/tools/CachedRead';

/** No-op 授权：cached_read 不触发越界工具门。 */
function noopAuth(): AuthorizationPort {
  return {
    ensureApproved: async function* (): AsyncGenerator<RunEvent, void, void> {},
  } as unknown as AuthorizationPort;
}

function makeCache(full: string): CachePort {
  return {
    resolve: vi.fn(async (_w: string, v: unknown) => v),
    readFile: vi.fn(
      async (
        _workDir: string,
        _filename: string,
        offset?: number,
        limit?: number,
      ) => {
        const o = offset ?? 0;
        return limit ? full.slice(o, o + limit) : full.slice(o);
      },
    ),
    offload: vi.fn(),
  };
}

function makeCtx(
  input: Record<string, unknown>,
  workDir = '/tmp/workdir',
): ToolCallContext {
  return {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir,
    llm: {} as never,
    auth: noopAuth(),
    runId: 'run_1',
    interactive: true,
    runtimeConfig: {},
  };
}

async function call(
  tool: CachedReadTool,
  ctx: ToolCallContext,
): Promise<{ events: RunEvent[]; ret: unknown }> {
  const events: RunEvent[] = [];
  const gen = tool.call(ctx);
  let ret: unknown;
  for (;;) {
    const r = await gen.next();
    if (r.done) {
      ret = r.value;
      break;
    }
    events.push(r.value);
  }
  return { events, ret };
}

describe('CachedReadTool', () => {
  it('passes offset/limit to readFile and returns the slice', async () => {
    const full = '0123456789'.repeat(1000); // 10K chars
    const cache = makeCache(full);
    const tool = new CachedReadTool(cache);
    const { ret } = await call(
      tool,
      makeCtx({ key: 'fc_x', offset: 0, limit: 2000 }),
    );
    expect(cache.readFile).toHaveBeenCalledWith(
      '/tmp/workdir',
      'fc_x',
      0,
      2000,
    );
    expect(typeof ret).toBe('string');
  });

  it('appends a continue-reading footer when limit given and chunk is full', async () => {
    const full = 'a'.repeat(5000);
    const cache = makeCache(full);
    const tool = new CachedReadTool(cache);
    const { ret } = await call(
      tool,
      makeCtx({ key: 'fc_pdf', offset: 0, limit: 2000 }),
    );
    const s = ret as string;
    expect(s).toContain(
      'continue with cached_read(key="fc_pdf", offset=2000, limit=2000)',
    );
    expect(s).toContain('[read offset=0 limit=2000;');
  });

  it('continues from a non-zero offset', async () => {
    const full = 'a'.repeat(5000);
    const cache = makeCache(full);
    const tool = new CachedReadTool(cache);
    const { ret } = await call(
      tool,
      makeCtx({ key: 'fc_pdf', offset: 2000, limit: 2000 }),
    );
    expect(ret as string).toContain('offset=4000, limit=2000');
  });

  it('no footer when chunk is partial (end of file reached)', async () => {
    // offset=4500 limit=2000 → only 500 chars left → result.length < limit → no footer
    const full = 'a'.repeat(5000);
    const cache = makeCache(full);
    const tool = new CachedReadTool(cache);
    const { ret } = await call(
      tool,
      makeCtx({ key: 'fc_pdf', offset: 4500, limit: 2000 }),
    );
    expect(ret as string).not.toContain('continue with');
  });

  it('bare read (no limit) returns full content, no footer', async () => {
    const full = 'a'.repeat(5000);
    const cache = makeCache(full);
    const tool = new CachedReadTool(cache);
    const { ret } = await call(tool, makeCtx({ key: 'fc_pdf' }));
    expect(ret).toBe(full);
  });

  it('passes through object (JSON) content unchanged', async () => {
    const obj = { flights: [{ id: 'f1' }] };
    const cache: CachePort = {
      resolve: vi.fn(),
      readFile: vi.fn(async () => obj),
      offload: vi.fn(),
    };
    const tool = new CachedReadTool(cache);
    const { ret } = await call(
      tool,
      makeCtx({ key: 'fc_obj', offset: 0, limit: 2000 }),
    );
    expect(ret).toEqual(obj);
  });
});
