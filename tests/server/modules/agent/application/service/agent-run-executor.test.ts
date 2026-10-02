import { describe, it, expect } from 'vitest';
import {
  parseResponse,
  restoreReactMessage,
} from '@/server/modules/agent/application/service/react-message';
import type { LlmMessage } from '@/shared/types/entities';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';

function makeExecutor(): AgentRunExecutor {
  const noopStageOrHook = { apply: async function* () {} };
  return new AgentRunExecutor(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      buildResolvedRunConfig: () =>
        RunConfigVO.of({ tools: [], runtimeConfig: { model: {} } }),
    } as never,
    { resolve: async () => noopStageOrHook } as never,
    { collectConversationFeed: () => null } as never,
  );
}

describe('restoreReactMessage', () => {
  it('assistant + summary → 注入 thought 的 response_user XML（parseResponse 可还原）', () => {
    const m = restoreReactMessage({
      role: 'assistant',
      content: 'hello',
      summary: 'did X then Y',
    });
    expect(m.role).toBe('assistant');
    expect(parseResponse(m.content)[0]).toEqual({
      thought: 'did X then Y',
      tool: 'response_user',
      input: { message: 'hello' },
    });
  });

  it('assistant 无 summary → 无 thought 标签（parsed.thought 为 undefined）', () => {
    const m = restoreReactMessage({ role: 'assistant', content: 'hi' });
    const parsed = parseResponse(m.content)[0]!;
    expect(parsed).toEqual({
      thought: undefined,
      tool: 'response_user',
      input: { message: 'hi' },
    });
    expect(parsed.thought).toBeUndefined();
  });

  it('非 assistant 原样透传（role+content）', () => {
    expect(restoreReactMessage({ role: 'system', content: 'sys' })).toEqual({
      role: 'system',
      content: 'sys',
    });
    expect(restoreReactMessage({ role: 'user', content: 'q' })).toEqual({
      role: 'user',
      content: 'q',
    });
  });

  it('作为 Array.map 的逐项函数：整条种子链式还原', () => {
    // 镜像 createRun 的用法：params.seed.map(restoreReactMessage)
    const seed: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', summary: 'S' },
    ];
    const out = seed.map(restoreReactMessage);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'q' });
    expect(parseResponse(out[2]!.content)[0]).toEqual({
      thought: 'S',
      tool: 'response_user',
      input: { message: 'a' },
    });
  });
});

describe('createRun（ephemeral 日期行）', () => {
  it('working set 在 system 后插入 <today> 行，base 覆盖它；seed 原序不变', async () => {
    const { ctx } = await makeExecutor().createRun({
      runId: 'run_x',
      workDir: '/tmp/w',
      conversationId: 'conv_x',
      runtimeConfig: { model: {} } as never,
      seed: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
      ],
      toolSet: {} as never,
      interactive: true,
    });
    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[1]!.role).toBe('user');
    expect(ctx.messages[1]!.content).toMatch(/^<today>.+<\/today>$/);
    expect(ctx.messages[2]!.content).toBe('q');
    expect(ctx.base).toBe(3); // seed 2 + today 1
  });
});
