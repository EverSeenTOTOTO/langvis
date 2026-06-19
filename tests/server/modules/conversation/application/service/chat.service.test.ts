import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { Role } from '@/shared/entities/Message';

function makeMockMessageRepo(): MessageRepositoryPort {
  return {
    batchCreate: vi.fn().mockResolvedValue([]),
    findByConversationId: vi.fn().mockResolvedValue([]),
    findLastAssistantMessage: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({} as any),
    batchDeleteInConversation: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(null),
    deleteAfter: vi.fn().mockResolvedValue(false),
  };
}

function makeMockAgentRunRepo(): AgentRunRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue({} as any),
    findById: vi.fn().mockResolvedValue(null),
    findByIds: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(null),
  };
}

function makeMockWorkspace(): WorkspaceService {
  return {
    getWorkDir: vi.fn().mockResolvedValue('/tmp/workdir'),
  } as unknown as WorkspaceService;
}

describe('ChatService', () => {
  let service: ChatService;
  let messageRepo: MessageRepositoryPort;
  let agentRunRepo: AgentRunRepositoryPort;
  let workspace: WorkspaceService;

  beforeEach(() => {
    messageRepo = makeMockMessageRepo();
    agentRunRepo = makeMockAgentRunRepo();
    workspace = makeMockWorkspace();
    service = new ChatService(messageRepo, agentRunRepo, workspace);
  });

  // ════════════════════════════════════════
  // 消息构建
  // ════════════════════════════════════════

  describe('activate', () => {
    it('creates activation messages when no existing messages', async () => {
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

    it('skips if messages already exist', async () => {
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
    it('creates user + assistant message pair', async () => {
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

    it('returns existing messages from repo', async () => {
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
  // BC 跨边界组合查询
  // ════════════════════════════════════════

  describe('findActiveAssistantMessages', () => {
    it('composes query across Message + AgentRun repos', async () => {
      const messages = [
        {
          id: 'msg_1',
          role: Role.ASSIST,
          agentRunId: 'run_1',
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
        {
          id: 'msg_2',
          role: Role.ASSIST,
          agentRunId: 'run_2',
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
        {
          id: 'msg_3',
          role: Role.USER,
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(messages);
      (agentRunRepo.findByIds as any).mockResolvedValue([
        { id: 'run_1', status: 'running' },
        { id: 'run_2', status: 'completed' },
      ]);

      const result = await service.findActiveAssistantMessages('conv_1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg_1');
    });

    it('returns empty when no active runs', async () => {
      const messages = [
        {
          id: 'msg_1',
          role: Role.ASSIST,
          agentRunId: 'run_1',
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(messages);
      (agentRunRepo.findByIds as any).mockResolvedValue([
        { id: 'run_1', status: 'completed' },
      ]);

      const result = await service.findActiveAssistantMessages('conv_1');

      expect(result).toHaveLength(0);
    });
  });

  describe('markMessagesFailed', () => {
    it('updates Message content + AgentRun status', async () => {
      const messages = [
        {
          id: 'msg_1',
          role: Role.ASSIST,
          agentRunId: 'run_1',
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
        {
          id: 'msg_2',
          role: Role.ASSIST,
          agentRunId: 'run_2',
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
      ];

      await service.markMessagesFailed(messages, 'Generation interrupted');

      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'Generation interrupted',
      });
      expect(messageRepo.update).toHaveBeenCalledWith('msg_2', {
        content: 'Generation interrupted',
      });
      expect(agentRunRepo.update).toHaveBeenCalledWith('run_1', {
        status: 'failed',
        completedAt: expect.any(Date),
      });
      expect(agentRunRepo.update).toHaveBeenCalledWith('run_2', {
        status: 'failed',
        completedAt: expect.any(Date),
      });
    });

    it('skips AgentRun update when no agentRunId', async () => {
      const messages = [
        {
          id: 'msg_1',
          role: Role.USER,
          agentRunId: null,
          content: '',
          createdAt: new Date(),
          conversationId: 'conv_1',
        },
      ];

      await service.markMessagesFailed(messages, 'Error');

      expect(messageRepo.update).toHaveBeenCalledTimes(1);
      expect(agentRunRepo.update).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════
  // 其他
  // ════════════════════════════════════════

  describe('getHistoryMessages', () => {
    it('returns all messages for conversation', async () => {
      const messages = [
        { id: 'msg_1', role: Role.SYSTEM, content: 'prompt' },
        { id: 'msg_2', role: Role.USER, content: 'question' },
      ];
      (messageRepo.findByConversationId as any).mockResolvedValue(messages);

      const result = await service.getHistoryMessages('conv_1');

      expect(result).toBe(messages);
    });

    it('excludes a specific message when provided', async () => {
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

  describe('persistAgentRunId', () => {
    it('writes agentRunId to Message (fire-and-forget)', () => {
      service.persistAgentRunId('msg_1', 'run_1');
      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        agentRunId: 'run_1',
      });
    });
  });
});
