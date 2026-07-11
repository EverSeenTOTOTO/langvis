import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { Role } from '@/shared/entities/Message';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';

function makeMockMessageRepo(): MessageRepositoryPort {
  return {
    batchCreate: vi.fn().mockResolvedValue([]),
    findByConversationId: vi.fn().mockResolvedValue([]),
    findByAgentRunIds: vi.fn().mockResolvedValue([]),
    findLastAssistantMessage: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
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
    findNonTerminal: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(null),
  };
}

function makeMockWorkspace(): WorkspaceService {
  return {
    getWorkDir: vi.fn().mockResolvedValue('/tmp/workdir'),
  } as unknown as WorkspaceService;
}

function makeMockConvRepo(): ConversationRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as ConversationRepositoryPort;
}

describe('ChatService', () => {
  let service: ChatService;
  let messageRepo: MessageRepositoryPort;
  let agentRunRepo: AgentRunRepositoryPort;
  let workspace: WorkspaceService;
  let convRepo: ConversationRepositoryPort;

  beforeEach(() => {
    messageRepo = makeMockMessageRepo();
    agentRunRepo = makeMockAgentRunRepo();
    workspace = makeMockWorkspace();
    convRepo = makeMockConvRepo();
    service = new ChatService(messageRepo, convRepo, agentRunRepo, workspace);
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
          expect.objectContaining({
            role: Role.USER,
            meta: { kind: 'context' },
          }),
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

  describe('markMessagesTerminated', () => {
    it('updates Message content + AgentRun status (failed)', async () => {
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

      await service.markMessagesTerminated(
        messages,
        'failed',
        'Generation interrupted',
      );

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

    it('propagates cancelled status + reason as content', async () => {
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

      await service.markMessagesTerminated(messages, 'cancelled', 'Cancelled');

      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'Cancelled',
      });
      expect(agentRunRepo.update).toHaveBeenCalledWith('run_1', {
        status: 'cancelled',
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

      await service.markMessagesTerminated(messages, 'failed', 'Error');

      expect(messageRepo.update).toHaveBeenCalledTimes(1);
      expect(agentRunRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('markInterruptedRuns', () => {
    it('把所有非终态 run 标记 failed 并更新其消息文案', async () => {
      (agentRunRepo.findNonTerminal as any).mockResolvedValue([
        { id: 'run_1' },
        { id: 'run_2' },
      ]);
      (messageRepo.findByAgentRunIds as any).mockResolvedValue([
        { id: 'msg_1', agentRunId: 'run_1' },
        { id: 'msg_2', agentRunId: 'run_2' },
      ]);

      const count = await service.markInterruptedRuns('Generation interrupted');

      expect(count).toBe(2);
      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'Generation interrupted',
      });
      expect(agentRunRepo.update).toHaveBeenCalledWith('run_1', {
        status: 'failed',
        completedAt: expect.any(Date),
      });
    });

    it('无非终态 run 时返回 0 且不查消息', async () => {
      const count = await service.markInterruptedRuns('x');

      expect(count).toBe(0);
      expect(messageRepo.findByAgentRunIds).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════
  // 其他
  // ════════════════════════════════════════

  describe('persistAgentRunId', () => {
    it('writes agentRunId to Message (fire-and-forget)', () => {
      service.persistAgentRunId('msg_1', 'run_1');
      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        agentRunId: 'run_1',
      });
    });
  });

  // ════════════════════════════════════════
  // 归属校验 / turn 编排(从 handler 下沉至此)
  // ════════════════════════════════════════

  describe('requireConversation', () => {
    it('returns conversation when found for owner', async () => {
      const conv = { id: 'conv_1', userId: 'user_1', config: {} } as any;
      (convRepo.findById as any).mockResolvedValue(conv);

      await expect(
        service.requireConversation('conv_1', 'user_1'),
      ).resolves.toBe(conv);
      expect(convRepo.findById).toHaveBeenCalledWith('conv_1', 'user_1');
    });

    it('throws NotFound when missing or not owned (repo-scoped 统一 NotFound)', async () => {
      (convRepo.findById as any).mockResolvedValue(null);

      await expect(
        service.requireConversation('conv_1', 'user_1'),
      ).rejects.toBeInstanceOf(ConversationNotFoundError);
    });
  });

  describe('startTurn', () => {
    it('requireConversation → appendMessage; derives userConfig', async () => {
      const conv = {
        id: 'conv_1',
        userId: 'user_1',
        config: { model: { modelId: 'm1' } },
      } as any;
      (convRepo.findById as any).mockResolvedValue(conv);
      (messageRepo.findByConversationId as any).mockResolvedValue([
        { id: 'msg_sys', role: Role.SYSTEM, content: 'SYS PROMPT' },
      ]);

      const result = await service.startTurn({
        conversationId: 'conv_1',
        userId: 'user_1',
        userMessage: { role: Role.USER, content: 'hi' },
      });

      expect(result.userConfig).toEqual({ model: { modelId: 'm1' } });
      expect(result.userMessage.role).toBe(Role.USER);
      expect(result.assistantMessage.role).toBe(Role.ASSIST);
    });

    it('throws NotFound when conversation missing', async () => {
      (convRepo.findById as any).mockResolvedValue(null);

      await expect(
        service.startTurn({
          conversationId: 'conv_1',
          userId: 'user_1',
          userMessage: { role: Role.USER, content: 'hi' },
        }),
      ).rejects.toBeInstanceOf(ConversationNotFoundError);
    });
  });

  describe('persistAssistantTurn', () => {
    function ev(p: { type: string } & Record<string, unknown>): any {
      return { runId: 'run_1', seq: 0, at: 0, ...p };
    }

    it('投影终态文案持久化（无 audio 时只更 content），返回更新后的消息', async () => {
      (messageRepo.update as any).mockResolvedValue({
        id: 'msg_1',
        content: 'Hello',
      });

      const msg = await service.persistAssistantTurn('msg_1', [
        ev({ type: 'text_chunk', content: 'Hello' }),
        ev({ type: 'final' }),
      ]);

      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'Hello',
      });
      expect(msg).toEqual({ id: 'msg_1', content: 'Hello' });
    });

    it('只做投影+持久化：不触发压缩/落盘（那些是 turn-end transform 职责）', async () => {
      (messageRepo.update as any).mockResolvedValue({ id: 'msg_1' });
      await service.persistAssistantTurn('msg_1', [ev({ type: 'final' })]);
      expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    });

    it('audio 不入 meta：即便事件流含 audio 事件，也只持久化 content', async () => {
      (messageRepo.update as any).mockResolvedValue({ id: 'msg_1' });
      await service.persistAssistantTurn('msg_1', [
        ev({ type: 'text_chunk', content: 'Hello' }),
        ev({ type: 'audio', filePath: 'tts/run_1.mp3', voice: 'V' }),
        ev({ type: 'final' }),
      ]);
      expect(messageRepo.update).toHaveBeenCalledWith('msg_1', {
        content: 'Hello',
      });
    });
  });
});
