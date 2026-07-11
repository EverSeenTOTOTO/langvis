import { describe, it, expect } from 'vitest';
import { restoreReactMessage } from '@/server/modules/agent/application/service/agent-run-executor';
import type { LlmMessage } from '@/shared/types/entities';

describe('restoreReactMessage', () => {
  it('assistant + summary → 注入 thought 的 response_user JSON', () => {
    const m = restoreReactMessage({
      role: 'assistant',
      content: 'hello',
      summary: 'did X then Y',
    });
    expect(m.role).toBe('assistant');
    expect(JSON.parse(m.content)).toEqual({
      thought: 'did X then Y',
      tool: 'response_user',
      input: { message: 'hello' },
    });
  });

  it('assistant 无 summary → 无 thought 键', () => {
    const m = restoreReactMessage({ role: 'assistant', content: 'hi' });
    const parsed = JSON.parse(m.content);
    expect(parsed).toEqual({
      tool: 'response_user',
      input: { message: 'hi' },
    });
    expect(parsed).not.toHaveProperty('thought');
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

  it('作为 ListMonad.map 的逐项函数：整条种子链式还原', () => {
    // 镜像 createRun 的用法：ListMonad.of(seed).map(restoreReactMessage)
    const seed: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', summary: 'S' },
    ];
    const out = seed.map(restoreReactMessage);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'q' });
    expect(JSON.parse(out[2].content)).toEqual({
      thought: 'S',
      tool: 'response_user',
      input: { message: 'a' },
    });
  });
});
