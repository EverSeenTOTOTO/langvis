import { ConversationService } from '@/server/service/ConversationService';
import { Role } from '@/shared/entities/Message';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockMessageRepo(): any {
  return {
    batchCreate: vi.fn(async (_id: string, data: any) =>
      data.map((d: any) => ({ ...d, id: d.id ?? 'msg_new' })),
    ),
    findLastAssistantMessage: vi.fn(async () => null),
    findActiveAssistantMessages: vi.fn(async () => []),
    findByConversationId: vi.fn(async () => []),
    save: vi.fn(async m => m),
    batchDeleteInConversation: vi.fn(async () => {}),
    update: vi.fn(async () => null),
    appendToolCallRecord: vi.fn(async () => {}),
    appendThought: vi.fn(async () => {}),
    deleteAfter: vi.fn(async () => false),
  };
}

function createMockConvRepo(): any {
  return {
    create: vi.fn(async () => ({ id: 'conv_1' }) as any),
    findById: vi.fn(async () => null),
    update: vi.fn(async () => null),
    delete: vi.fn(async () => false),
    createGroup: vi.fn(async () => ({ id: 'grp_1' }) as any),
    findGroupsByUserId: vi.fn(async () => ({ groups: [] })),
    updateGroup: vi.fn(async () => null),
    deleteGroup: vi.fn(async () => ({
      success: false,
      deletedConversationIds: [],
    })),
    reorderGroups: vi.fn(async () => {}),
    reorderConversationsInGroup: vi.fn(async () => {}),
  };
}

describe('ConversationService (facade)', () => {
  let service: ConversationService;
  let messageRepo: any;
  let convRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    messageRepo = createMockMessageRepo();
    convRepo = createMockConvRepo();
    service = new ConversationService(messageRepo, convRepo);
  });

  // ── Message delegation ──

  it('should delegate batchAddMessages to messageRepo.batchCreate', async () => {
    const data = [{ role: Role.USER, content: 'hello' }];
    await service.batchAddMessages('conv_1', data as any);

    expect(messageRepo.batchCreate).toHaveBeenCalledWith('conv_1', data);
  });

  it('should delegate getMessagesByConversationId to messageRepo', async () => {
    await service.getMessagesByConversationId('conv_1');
    expect(messageRepo.findByConversationId).toHaveBeenCalledWith('conv_1');
  });

  it('should delegate updateMessage to messageRepo', async () => {
    const partial = { content: 'updated' };
    await service.updateMessage('msg_1', partial);
    expect(messageRepo.update).toHaveBeenCalledWith('msg_1', partial);
  });

  it('should delegate appendToolCallRecord to messageRepo', async () => {
    const record = {
      callId: 'tc_1',
      toolName: 'test',
      status: 'completed' as const,
    };
    await service.appendToolCallRecord('msg_1', record as any);
    expect(messageRepo.appendToolCallRecord).toHaveBeenCalledWith(
      'msg_1',
      record,
    );
  });

  it('should delegate appendThought to messageRepo', async () => {
    await service.appendThought('msg_1', 'thinking...');
    expect(messageRepo.appendThought).toHaveBeenCalledWith(
      'msg_1',
      'thinking...',
    );
  });

  it('should delegate findActiveAssistantMessages to messageRepo', async () => {
    await service.findActiveAssistantMessages('conv_1');
    expect(messageRepo.findActiveAssistantMessages).toHaveBeenCalledWith(
      'conv_1',
    );
  });

  it('should delegate saveMessage to messageRepo', async () => {
    const msg = { id: 'msg_1', content: 'test' } as any;
    await service.saveMessage(msg);
    expect(messageRepo.save).toHaveBeenCalledWith(msg);
  });

  it('should delegate batchDeleteMessagesInConversation to messageRepo', async () => {
    await service.batchDeleteMessagesInConversation('conv_1', ['msg_1']);
    expect(messageRepo.batchDeleteInConversation).toHaveBeenCalledWith(
      'conv_1',
      ['msg_1'],
    );
  });

  it('should delegate deleteMessagesAfter to messageRepo', async () => {
    await service.deleteMessagesAfter('conv_1', 'msg_1');
    expect(messageRepo.deleteAfter).toHaveBeenCalledWith('conv_1', 'msg_1');
  });

  // ── Conversation delegation ──

  it('should delegate createConversation to convRepo', async () => {
    await service.createConversation('Test', 'user_1');
    expect(convRepo.create).toHaveBeenCalledWith(
      'Test',
      'user_1',
      undefined,
      undefined,
      undefined,
    );
  });

  it('should delegate getConversationById to convRepo', async () => {
    await service.getConversationById('conv_1');
    expect(convRepo.findById).toHaveBeenCalledWith('conv_1', undefined);
  });

  it('should delegate getConversationById with userId to convRepo', async () => {
    await service.getConversationById('conv_1', 'user_1');
    expect(convRepo.findById).toHaveBeenCalledWith('conv_1', 'user_1');
  });

  it('should delegate updateConversation to convRepo', async () => {
    await service.updateConversation('conv_1', 'New Name', 'user_1');
    expect(convRepo.update).toHaveBeenCalledWith(
      'conv_1',
      'New Name',
      'user_1',
      undefined,
      undefined,
      undefined,
    );
  });

  it('should delegate deleteConversation to convRepo', async () => {
    await service.deleteConversation('conv_1', 'user_1');
    expect(convRepo.delete).toHaveBeenCalledWith('conv_1', 'user_1');
  });
});
