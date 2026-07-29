import { describe, it, expect } from 'vitest';
import { restoreReactMessage } from '@/server/modules/agent/application/service/agent-run-executor';
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import type { LlmMessage } from '@/shared/types/entities';

describe('restoreReactMessage', () => {
  it('assistant + summary → 注入 thought 的 response_user XML（parseResponse 可还原）', () => {
    const m = restoreReactMessage({
      role: 'assistant',
      content: 'hello',
      summary: 'did X then Y',
    });
    expect(m.role).toBe('assistant');
    expect(parseResponse(m.content)).toEqual({
      thought: 'did X then Y',
      tool: 'response_user',
      input: { message: 'hello' },
    });
  });

  it('assistant 无 summary → 无 thought 标签（parsed.thought 为 undefined）', () => {
    const m = restoreReactMessage({ role: 'assistant', content: 'hi' });
    const parsed = parseResponse(m.content);
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
    expect(parseResponse(out[2]!.content)).toEqual({
      thought: 'S',
      tool: 'response_user',
      input: { message: 'a' },
    });
  });
});
