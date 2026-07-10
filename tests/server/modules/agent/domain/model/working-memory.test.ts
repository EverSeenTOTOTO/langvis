import { describe, it, expect } from 'vitest';
import { WorkingMemory } from '@/server/modules/agent/domain/model/working-memory';
import type { LlmMessage } from '@/shared/types/entities';

function makeWorking(seed: LlmMessage[], contextSize = 10): WorkingMemory {
  return new WorkingMemory({ seed, contextSize });
}

describe('WorkingMemory（贫血：状态 MessageList monad + 读写缝）', () => {
  it('buildContext 返回当前消息；baseLength = seed 长度', async () => {
    const seed: LlmMessage[] = [{ role: 'system', content: 'sys' }];
    const w = makeWorking(seed);
    expect((await w.buildContext()).length).toBe(1);
    expect(w.baseLength).toBe(1);
  });

  it('append 经 monad 增长迭代消息', async () => {
    const w = makeWorking([{ role: 'system', content: 'sys' }]);
    w.append('user', 'q1');
    w.append('assistant', 'a1');
    expect((await w.buildContext()).length).toBe(3);
    expect(w.baseLength).toBe(1); // seed 不变
  });

  it('messages 是不可变 monad：append 产出新值、不影响旧引用', () => {
    const w = makeWorking([{ role: 'system', content: 'sys' }]);
    const before = w.messages;
    w.append('user', 'q1');
    expect(w.messages).not.toBe(before); // 新 MessageList 实例
    expect(before.length).toBe(1); // 旧值不变
    expect(w.messages.length).toBe(2);
  });
});
