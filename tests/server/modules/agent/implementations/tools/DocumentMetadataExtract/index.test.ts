import { describe, it, expect, vi } from 'vitest';
import { createTool } from '@/server/modules/agent/application/tools/register-tool';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import DocumentMetadataExtractTool from '@/server/modules/agent/implementations/tools/DocumentMetadataExtract/index';
import { config } from '@/server/modules/agent/implementations/tools/DocumentMetadataExtract/config';

async function drain(gen: AsyncGenerator<unknown, unknown, void>) {
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return r.value;
}

function makeCtx(
  input: Record<string, unknown>,
  llm: unknown,
): ToolCallContext {
  return {
    input,
    workDir: '/w',
    callId: 'tc_test',
    signal: new AbortController().signal,
    runtimeConfig: {},
    llm,
  } as unknown as ToolCallContext;
}

const META_JSON = JSON.stringify({
  title: 'T',
  summary: 'S',
  keywords: ['k'],
  category: 'tech_blog',
  metadata: { platform: 'kube.io' },
});

function makeTool(workspace: unknown) {
  return createTool(DocumentMetadataExtractTool as never, config as never, [
    workspace,
  ]);
}

describe('DocumentMetadataExtract 契约', () => {
  it('rawFile 单独提供即合法：通过 schema 校验，自读文件，content 不再是必填', async () => {
    const workspace = {
      readFile: vi.fn().mockResolvedValue({ content: '正文'.repeat(50) }),
    };
    const llm = { chatContent: vi.fn().mockResolvedValue(META_JSON) };
    const tool = makeTool(workspace);

    const out = (await drain(
      tool.call(makeCtx({ rawFile: 'article.md' }, llm)),
    )) as { title: string; metadata: Record<string, unknown> };

    expect(out.title).toBe('T');
    expect(out.metadata).toEqual({ platform: 'kube.io' });
    expect(workspace.readFile).toHaveBeenCalledWith('article.md', '/w');
  });

  it('content 与 rawFile 都不传：明确报错（不再静默分析空串）', async () => {
    const tool = makeTool({ readFile: vi.fn() });
    await expect(
      drain(tool.call(makeCtx({ sourceType: 'web' }, {}))),
    ).rejects.toThrow(/either `content`.*`rawFile`/);
  });
});
