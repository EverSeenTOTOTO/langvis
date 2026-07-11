import { describe, it, expect } from 'vitest';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';

describe('RuntimeConfigVO', () => {
  describe('of', () => {
    it('存储字段为不可变快照', () => {
      const config = RuntimeConfigVO.of({
        systemPrompt: 'You are helpful',
        tools: ['tool_a', 'tool_b'],
        runtimeConfig: { model: { modelId: 'gpt-4' } },
      });

      expect(config.systemPrompt).toBe('You are helpful');
      expect(config.tools).toEqual(['tool_a', 'tool_b']);
      expect(config.runtimeConfig).toEqual({ model: { modelId: 'gpt-4' } });
    });

    it('产出 frozen 对象', () => {
      const config = RuntimeConfigVO.of({
        systemPrompt: 'p',
        tools: [],
        runtimeConfig: {},
      });

      expect(Object.isFrozen(config)).toBe(true);
      expect(() => ((config as any).tools = [])).toThrow();
    });

    it('tools 默认透传（空数组即空数组）', () => {
      const config = RuntimeConfigVO.of({
        systemPrompt: 'p',
        tools: [],
        runtimeConfig: {},
      });

      expect(config.tools).toEqual([]);
    });
  });
});
