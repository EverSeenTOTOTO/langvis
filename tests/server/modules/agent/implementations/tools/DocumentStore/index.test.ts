import { describe, it, expect, vi } from 'vitest';
import { createTool } from '@/server/modules/agent/application/tools/register-tool';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import DocumentStoreTool from '@/server/modules/agent/implementations/tools/DocumentStore/index';
import { config } from '@/server/modules/agent/implementations/tools/DocumentStore/config';

async function drain(gen: AsyncGenerator<unknown, unknown, void>) {
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return r.value;
}

function makeCtx(input: Record<string, unknown>): ToolCallContext {
  return {
    input,
    workDir: '/w',
    callId: 'tc_test',
    signal: new AbortController().signal,
    runtimeConfig: {},
  } as unknown as ToolCallContext;
}

function makeTool() {
  const embedInputs: unknown[] = [];
  const chunkTool = {
    call: async function* () {
      return {
        chunks: [
          { content: 'a', index: 0 },
          { content: 'b', index: 1 },
        ],
      };
    },
  };
  const embedTool = {
    call: async function* (ctx: ToolCallContext) {
      embedInputs.push(ctx.input);
      return { embeddings: [[0.1], [0.2]] };
    },
  };
  const toolService = {
    resolve: vi.fn((id: string) =>
      id === 'content_chunk' ? chunkTool : embedTool,
    ),
  };
  const manager = {
    create: vi.fn((_E: unknown, data: Record<string, unknown>) => ({
      ...data,
      id: 'doc_1',
    })),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    dataSource: {
      transaction: vi.fn((cb: (m: unknown) => unknown) => cb(manager)),
    },
  };
  const tool = createTool(DocumentStoreTool as never, config as never, [
    db,
    { readFile: vi.fn() },
    toolService,
  ]);
  return { tool, embedInputs };
}

const baseDoc = {
  title: 'T',
  summary: 'S',
  keywords: ['k'],
  category: 'tech_blog',
  metadata: { platform: 'kube.io' },
  sourceType: 'web',
};

describe('DocumentStore 契约', () => {
  it('内部 EmbeddingGenerate 收到 {content,index} 对象——而非裸字符串（chunks/N must be object 回归）', async () => {
    const { tool, embedInputs } = makeTool();

    const out = (await drain(
      tool.call(makeCtx({ document: { ...baseDoc, rawContent: 'text' } })),
    )) as { documentId: string; chunkCount: number };

    expect(out).toEqual({ documentId: 'doc_1', chunkCount: 2 });
    expect(embedInputs).toEqual([
      {
        chunks: [
          { content: 'a', index: 0 },
          { content: 'b', index: 1 },
        ],
      },
    ]);
  });

  it('rawContent 与 rawFile 都不传：明确报错（不再静默存空文档）', async () => {
    const { tool } = makeTool();
    const doc = { ...baseDoc } as Record<string, unknown>;
    delete (doc as { rawContent?: string }).rawContent;
    await expect(drain(tool.call(makeCtx({ document: doc })))).rejects.toThrow(
      /either `document.rawContent`.*`document.rawFile`/,
    );
  });
});
