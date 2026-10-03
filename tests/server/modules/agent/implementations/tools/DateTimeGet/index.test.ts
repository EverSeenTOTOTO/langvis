import { describe, it, expect } from 'vitest';
import { createTool } from '@/server/modules/agent/application/tools/register-tool';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import DateTimeGetTool from '@/server/modules/agent/implementations/tools/DateTimeGet/index';
import { config } from '@/server/modules/agent/implementations/tools/DateTimeGet/config';

async function drain(gen: AsyncGenerator<unknown, unknown, void>) {
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return r.value;
}

function makeTool() {
  return createTool(DateTimeGetTool as never, config as never, []);
}

function ctxOf(input: Record<string, unknown>): ToolCallContext {
  return {
    input,
    workDir: '/w',
    callId: 'tc_test',
    signal: new AbortController().signal,
    runtimeConfig: {},
  } as unknown as ToolCallContext;
}

describe('DateTimeGet 契约', () => {
  it('省略 timezone 即宿主本地时区，返回非空结果', async () => {
    const tool = makeTool();
    const omitted = (await drain(tool.call(ctxOf({})))) as { result: string };

    expect(omitted.result.length).toBeGreaterThan(0);
  });

  it('IANA 名正常解析', async () => {
    const tool = makeTool();
    const out = (await drain(
      tool.call(ctxOf({ timezone: 'Asia/Shanghai' })),
    )) as { result: string };
    expect(out.result.length).toBeGreaterThan(0);
  });

  it('非法时区报错自带默认时区当前时间（模型无需补救一轮）', async () => {
    const tool = makeTool();
    await expect(
      drain(tool.call(ctxOf({ timezone: 'Not/AZone' }))),
    ).rejects.toThrow(
      new RegExp(
        `Invalid IANA timezone 'Not/AZone'. Current time in the server default timezone \\(.+\\): \\d{4}`,
      ),
    );
  });
});
