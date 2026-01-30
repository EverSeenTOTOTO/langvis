import { Memory } from '@/server/core/memory';
import { Logger } from '@/server/utils/logger';
import { Message } from '@/shared/entities/Message';
import { describe, expect, it, vi } from 'vitest';

class TestMemory extends Memory {
  protected readonly logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  conversationId?: string;
  userId?: string;

  async store(_memory: any): Promise<void> {}

  async retrieve(_fact: any): Promise<any> {
    return [];
  }

  async clearByConversationId(_conversationId: string): Promise<void> {}

  async clearByUserId(_userId: string): Promise<void> {}

  async summarize(): Promise<Message[]> {
    return [];
  }
}

describe('Memory base class', () => {
  it('should set conversationId via setConversationId', () => {
    const memory = new TestMemory();
    expect(memory.conversationId).toBeUndefined();
    memory.setConversationId('conv-123');
    expect(memory.conversationId).toBe('conv-123');
  });

  it('should set userId via setUserId', () => {
    const memory = new TestMemory();
    expect(memory.userId).toBeUndefined();
    memory.setUserId('user-456');
    expect(memory.userId).toBe('user-456');
  });

  it('should allow setting both conversationId and userId', () => {
    const memory = new TestMemory();
    memory.setConversationId('conv-789');
    memory.setUserId('user-012');
    expect(memory.conversationId).toBe('conv-789');
    expect(memory.userId).toBe('user-012');
  });

  it('should allow overwriting conversationId', () => {
    const memory = new TestMemory();
    memory.setConversationId('conv-1');
    memory.setConversationId('conv-2');
    expect(memory.conversationId).toBe('conv-2');
  });

  it('should allow overwriting userId', () => {
    const memory = new TestMemory();
    memory.setUserId('user-1');
    memory.setUserId('user-2');
    expect(memory.userId).toBe('user-2');
  });
});
