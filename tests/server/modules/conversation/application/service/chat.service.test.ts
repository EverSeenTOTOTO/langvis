import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { EventBus } from '@/server/libs/ddd';
import { Chat } from '@/server/modules/conversation/domain/model/chat';
import { Role } from '@/shared/entities/Message';
import { DuplicateRunError } from '@/server/modules/conversation/domain/errors';
import { TurnCancellationRequested } from '@/server/modules/conversation/contracts';

function makeMockMessageRepo(): MessageRepositoryPort {
  return {
    batchCreate: vi.fn().mockResolvedValue([]),
    findByConversationId: vi.fn().mockResolvedValue([]),
    findLastAssistantMessage: vi.fn().mockResolvedValue(null),
    findActiveAssistantMessages: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({} as any),
    batchDeleteInConversation: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(null),
    deleteAfter: vi.fn().mockResolvedValue(false),
  };
}

function makeMockWorkspace(): WorkspaceService {
  return {
    getWorkDir: vi.fn().mockResolvedValue('/tmp/workdir'),
  } as unknown as WorkspaceService;
}

function makeMockEventBus(): EventBus {
  return {
    dispatch: vi.fn(),
  } as unknown as EventBus;
}

describe('ChatService', () => {
  let service: ChatService;
  let messageRepo: MessageRepositoryPort;
  let workspace: WorkspaceService;
  let eventBus: EventBus;

  beforeEach(() => {
    messageRepo = makeMockMessageRepo();
    workspace = makeMockWorkspace();
    eventBus = makeMockEventBus();
    service = new ChatService(messageRepo, workspace, eventBus);
  });

  // ════════════════════════════════════════
  // 聚合根生命周期
  // ════════════════════════════════════════

  describe('getOrCreateChat', () => {
    it('should create a new Chat if none exists', () => {
      const chat = service.getOrCreateChat('conv_1');

      expect(chat).toBeInstanceOf(Chat);
      expect(chat.phase).toBe('waiting');
    });

    it('should return existing Chat on second call', () => {
      const first = service.getOrCreateChat('conv_1');
      const second = service.getOrCreateChat('conv_1');

      expect(first).toBe(second);
    });
  });

  describe('getChat', () => {
    it('should return undefined for unknown chat', () => {
      expect(service.getChat('unknown')).toBeUndefined();
    });

    it('should return chat after creation', () => {
      service.getOrCreateChat('conv_1');
      expect(service.getChat('conv_1')).toBeInstanceOf(Chat);
    });
  });

  // ════════════════════════════════════════
  // Turn 生命周期
  // ════════════════════════════════════════

  describe('startTurn', () => {
    it('should start a turn on the Chat aggregate', () => {
      const chat = service.startTurn('conv_1', 'msg_1');

      expect(chat.hasActiveMessage('msg_1')).toBe(true);
      expect(chat.phase).toBe('active');
    });

    it('should throw DuplicateRunError for same messageId', () => {
      service.startTurn('conv_1', 'msg_1');

      expect(() => service.startTurn('conv_1', 'msg_1')).toThrow(
        DuplicateRunError,
      );
    });
  });

  describe('completeTurn', () => {
    it('should complete a turn and return to waiting', () => {
      service.startTurn('conv_1', 'msg_1');
      const chat = service.completeTurn('conv_1', 'msg_1');

      expect(chat!.phase).toBe('waiting');
      expect(chat!.hasActiveMessage('msg_1')).toBe(false);
    });

    it('should return undefined for unknown chat', () => {
      expect(service.completeTurn('unknown', 'msg_1')).toBeUndefined();
    });
  });

  describe('requestCancellation', () => {
    it('should request cancellation and dispatch TurnCancellationRequested', () => {
      service.startTurn('conv_1', 'msg_1');
      const chat = service.requestCancellation('conv_1', 'msg_1', 'user abort');

      expect(chat).toBeDefined();
      expect(eventBus.dispatch).toHaveBeenCalledWith(
        TurnCancellationRequested,
        expect.anything(),
      );
    });

    it('should return undefined for unknown chat', () => {
      expect(service.requestCancellation('unknown')).toBeUndefined();
    });
  });

  // ════════════════════════════════════════
  // 消息构建
  // ════════════════════════════════════════

  describe('activate', () => {
    it('should create activation messages when no existing messages', async () => {
      (messageRepo.findByConversationId as any).mockResolvedValue([]);

      await service.activate({
        conversationId: 'conv_1',
        userId: 'user_1',
        systemPrompt: 'You are helpful',
      });

      expect(messageRepo.batchCreate).toHaveBeenCalledWith(
        'conv_1',
        expect.arrayContaining([
          expect.objectContaining({ role: Role.SYSTEM }),
          expect.objectContaining({ role: Role.USER, meta: { hidden: true } }),
        ]),
      );
    });

    it('should skip if messages already exist', async () => {
      (messageRepo.findByConversationId as any).mockResolvedValue([
        { id: 'msg_existing', role: Role.SYSTEM, content: 'old prompt' },
      ]);

      await service.activate({
        conversationId: 'conv_1',
        userId: 'user_1',
        systemPrompt: 'You are helpful',
      });

      expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    });
  });

  describe('appendMessage', () => {
    it('should create user + assistant message pair', async () => {
      (messageRepo.findByConversationId as any).mockResolvedValue([]);

      const result = await service.appendMessage({
        conversationId: 'conv_1',
        userMessage: { role: Role.USER, content: 'Hello' },
        assistantId: 'msg_assist',
      });

      expect(result.assistantId).toBe('msg_assist');
      expect(messageRepo.batchCreate).toHaveBeenCalledWith(
        'conv_1',
        expect.arrayContaining([
          expect.objectContaining({ role: Role.USER, content: 'Hello' }),
          expect.objectContaining({ role: Role.ASSIST }),
        ]),
      );
    });

    it('should return existing messages from repo', async () => {
      const existingMessages = [
        { id: 'msg_1', role: Role.SYSTEM, content: 'prompt' },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(
        existingMessages,
      );

      const result = await service.appendMessage({
        conversationId: 'conv_1',
        userMessage: { role: Role.USER, content: 'Hi' },
      });

      expect(result.existingMessages).toBe(existingMessages);
    });
  });

  // ════════════════════════════════════════
  // 持久化辅助
  // ════════════════════════════════════════

  describe('persistPendingMessage', () => {
    it('should update message with snapshot data', async () => {
      const chat = service.startTurn('conv_1', 'msg_1');
      // Simulate content accumulation
      chat.handleRunEvent('msg_1', {
        type: 'text_chunk',
        content: 'answer text',
        runId: 'run_1',
        seq: 1,
        at: Date.now(),
      } as any);

      await service.persistPendingMessage('conv_1', 'msg_1', 'run_1');

      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'answer text',
        steps: [],
        agentRunId: 'run_1',
        status: 'running',
      });
    });

    it('should do nothing for unknown chat', async () => {
      await service.persistPendingMessage('unknown', 'msg_1', 'run_1');
      expect(messageRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getHistoryMessages', () => {
    it('should return all messages for conversation', async () => {
      const messages = [
        { id: 'msg_1', role: Role.SYSTEM, content: 'prompt' },
        { id: 'msg_2', role: Role.USER, content: 'question' },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(messages);

      const result = await service.getHistoryMessages('conv_1');

      expect(result).toBe(messages);
    });

    it('should exclude a specific message when provided', async () => {
      const messages = [
        { id: 'msg_1', role: Role.SYSTEM, content: 'prompt' },
        { id: 'msg_2', role: Role.USER, content: 'question' },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(messages);

      const result = await service.getHistoryMessages('conv_1', 'msg_2');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg_1');
    });
  });

  describe('getPhase', () => {
    it('should return phase for existing chat', () => {
      service.getOrCreateChat('conv_1');
      expect(service.getPhase('conv_1')).toBe('waiting');
    });

    it('should return undefined for unknown chat', () => {
      expect(service.getPhase('unknown')).toBeUndefined();
    });
  });

  describe('hasActiveMessage', () => {
    it('should return true for active message', () => {
      service.startTurn('conv_1', 'msg_1');
      expect(service.hasActiveMessage('conv_1', 'msg_1')).toBe(true);
    });

    it('should return false for unknown chat', () => {
      expect(service.hasActiveMessage('unknown', 'msg_1')).toBe(false);
    });
  });
});
