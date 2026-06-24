import { describe, it, expect } from 'vitest';
import {
  MemoryFactory,
  type MemoryType,
} from '@/server/modules/memory/application/service/memory-factory';
import { SlidingWindowMemory } from '@/server/modules/memory/application/service/sliding-window.memory';
import { ReActMemory } from '@/server/modules/memory/application/service/react.memory';

describe('MemoryFactory', () => {
  const factory = new MemoryFactory();

  const baseParams = {
    history: [],
    contextSize: 8000,
    modelId: 'openai:gpt-4',
  };

  describe('create', () => {
    it('should return SlidingWindowMemory for slide_window_memory type', () => {
      const memory = factory.create({
        ...baseParams,
        memoryType: 'slide_window_memory',
      });

      expect(memory).toBeInstanceOf(SlidingWindowMemory);
    });

    it('should return ReActMemory for react_memory type', () => {
      const memory = factory.create({
        ...baseParams,
        memoryType: 'react_memory',
      });

      expect(memory).toBeInstanceOf(ReActMemory);
    });

    it('should default to SlidingWindowMemory for unknown type', () => {
      const memory = factory.create({
        ...baseParams,
        memoryType: 'unknown_type' as MemoryType,
      });

      expect(memory).toBeInstanceOf(SlidingWindowMemory);
    });

    it('should default windowSize to 10 when not provided', () => {
      const memory = factory.create({
        ...baseParams,
        memoryType: 'slide_window_memory',
      }) as SlidingWindowMemory;

      expect(memory.windowSize).toBe(10);
    });

    it('should use provided windowSize', () => {
      const memory = factory.create({
        ...baseParams,
        memoryType: 'slide_window_memory',
        windowSize: 20,
      }) as SlidingWindowMemory;

      expect(memory.windowSize).toBe(20);
    });

    it('should pass all params to strategy constructor', () => {
      const history = [{ id: 'msg_1', role: 'user', content: 'hi' }] as any[];
      const memory = factory.create({
        history,
        contextSize: 4096,
        modelId: 'model-x',
        memoryType: 'react_memory',
      }) as ReActMemory;

      // Memory has history internally — verify through getContextUsage
      const usage = memory.getContextUsage();
      expect(usage.total).toBe(4096);
    });
  });
});
