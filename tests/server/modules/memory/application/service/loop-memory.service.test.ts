import { describe, it, expect, vi } from 'vitest';
import '@/server/modules/memory/domain/service/compaction-config';
import '@/server/modules/agent/application/service/model-config.fragment';
import { LoopMemoryService } from '@/server/modules/memory/application/service/loop-memory.service';
import { LoopUsageReported } from '@/server/modules/memory/contracts';
import type { EventBus } from '@/server/libs/ddd';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { LlmMessage } from '@/shared/types/entities';

const COMPACTION = { threshold: 0.8, windowSize: 10, keepRecent: 4 };
const RUNTIME_CONFIG = { memory: { compaction: COMPACTION } };
const CONFIG = {
  contextSize: 100,
  modelId: 'openai:gpt-4',
  runtimeConfig: RUNTIME_CONFIG,
};

function mockLlm(content = 'RECAP'): LlmPort {
  return { chatContent: vi.fn(async () => content) } as unknown as LlmPort;
}
function mockEventBus() {
  return { dispatch: vi.fn() } as unknown as EventBus;
}
function makeService(llm: LlmPort = mockLlm(), eventBus = mockEventBus()) {
  return { service: new LoopMemoryService(llm, eventBus), llm, eventBus };
}
const signal = () => new AbortController().signal;

describe('LoopMemoryService —— agent 的同步 Customer-Supplier 端口', () => {
  it('beginRun + requestContext 返回种子', async () => {
    const { service } = makeService();
    service.beginRun('r1', [{ role: 'system', content: 'sys' }], CONFIG);
    const ctx = await service.requestContext('r1', signal());
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.content).toBe('sys');
  });

  it('record 追加后自发 LoopUsageReported（仅 runId）', () => {
    const { service, eventBus } = makeService();
    service.beginRun('r1', [{ role: 'system', content: 'sys' }], CONFIG);
    service.record('r1', 'user', 'hello');
    expect(eventBus.dispatch).toHaveBeenCalledWith(
      LoopUsageReported,
      expect.objectContaining({
        payload: { runId: 'r1', used: expect.any(Number), total: 100 },
      }),
    );
  });

  it('超阈时 requestContext 内部折叠较早步骤（agent 不点名 compact）', async () => {
    const { service, llm } = makeService(mockLlm('THE RECAP'));
    service.beginRun('r1', [{ role: 'system', content: 'sys' }], {
      ...CONFIG,
      contextSize: 10,
    });
    for (let i = 0; i < 6; i++) {
      service.record('r1', 'user', `observation step ${i}`);
    }
    const ctx = await service.requestContext('r1', signal());
    expect(llm.chatContent).toHaveBeenCalled();
    expect(ctx.some(m => m.content.includes('THE RECAP'))).toBe(true);
  });

  it('summarizeProcess 折叠过程摘要（>1 步）', async () => {
    const { service } = makeService(mockLlm('THE SUMMARY'));
    service.beginRun('r1', [{ role: 'system', content: 'sys' }], {
      ...CONFIG,
      contextSize: 1000,
    });
    service.record('r1', 'assistant', 'a1');
    service.record('r1', 'user', 'o1');
    service.record('r1', 'assistant', 'a2');
    expect(await service.summarizeProcess('r1', signal())).toBe('THE SUMMARY');
  });

  it('未 beginRun 时 requestContext 抛错（fail loud）', async () => {
    const { service } = makeService();
    await expect(service.requestContext('nope', signal())).rejects.toThrow();
  });

  it('endRun 后再 requestContext 抛错（已释放）', async () => {
    const { service } = makeService();
    service.beginRun('r1', [{ role: 'system', content: 'sys' }], CONFIG);
    service.endRun('r1');
    await expect(service.requestContext('r1', signal())).rejects.toThrow();
  });

  it('多次 run 互不干扰（runId 索引隔离）', async () => {
    const { service } = makeService();
    service.beginRun('r1', [{ role: 'system', content: 'sys1' }], {
      ...CONFIG,
      contextSize: 1000,
    });
    service.beginRun('r2', [{ role: 'system', content: 'sys2' }], {
      ...CONFIG,
      contextSize: 1000,
    });
    service.record('r1', 'user', 'only-in-r1');
    const ctx1 = await service.requestContext('r1', signal());
    const ctx2 = await service.requestContext('r2', signal());
    expect(ctx1.some((m: LlmMessage) => m.content === 'only-in-r1')).toBe(true);
    expect(ctx2.some((m: LlmMessage) => m.content === 'only-in-r1')).toBe(
      false,
    );
  });
});
