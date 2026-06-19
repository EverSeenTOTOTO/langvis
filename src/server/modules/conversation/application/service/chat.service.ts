import type { Message, MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { inject, singleton } from 'tsyringe';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import {
  createActivationMessages,
  createTurnMessages,
} from '../../domain/service/message-factory';
import Logger from '@/server/utils/logger';

/**
 * ChatService — Conversation BC 应用服务。
 *
 * 聚合根删除后只剩 Message CRUD + 跨 BC 组合查询。
 * session 生命周期 / SSE 桥 / run 跟踪归 SessionManager。
 */
@singleton()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  // ════════════════════════════════════════
  // 消息构建
  // ════════════════════════════════════════

  async activate(params: {
    conversationId: string;
    userId: string;
    systemPrompt: string;
  }): Promise<void> {
    const existing = await this.messageRepo.findByConversationId(
      params.conversationId,
    );
    if (existing.length > 0) return;

    const workDir = await this.workspaceService.getWorkDir(
      params.conversationId,
    );
    const messages = createActivationMessages({ ...params, workDir });
    await this.messageRepo.batchCreate(params.conversationId, messages);
  }

  async appendMessage(params: {
    conversationId: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, unknown> | null;
    };
    assistantId?: string;
  }): Promise<{
    existingMessages: Message[];
    assistantId: string;
    assistantMessage: Message;
  }> {
    const existingMessages = await this.messageRepo.findByConversationId(
      params.conversationId,
    );

    const { userMessage, assistantMessage } = createTurnMessages({
      conversationId: params.conversationId,
      userMessage: params.userMessage,
      assistantId: params.assistantId,
    });

    await this.messageRepo.batchCreate(params.conversationId, [
      userMessage,
      assistantMessage,
    ]);

    return {
      existingMessages,
      assistantId: assistantMessage.id,
      assistantMessage,
    };
  }

  // ════════════════════════════════════════
  // 持久化辅助
  // ════════════════════════════════════════

  persistAgentRunId(messageId: string, agentRunId: string): void {
    this.messageRepo.update(messageId, { agentRunId }).catch(err => {
      this.logger.warn('Failed to persist agentRunId', err);
    });
  }

  async getHistoryMessages(
    conversationId: string,
    excludeMessageId?: string,
  ): Promise<Message[]> {
    const all = await this.messageRepo.findByConversationId(conversationId);
    return excludeMessageId ? all.filter(m => m.id !== excludeMessageId) : all;
  }

  /**
   * Application-layer composition: find assistant messages with active agent runs.
   * Uses both repos (Message + AgentRun) — not a domain query crossing BC boundaries.
   */
  async findActiveAssistantMessages(
    conversationId: string,
  ): Promise<Message[]> {
    const messages =
      await this.messageRepo.findByConversationId(conversationId);
    const assistantMsgs = messages.filter(
      m => m.role === Role.ASSIST && m.agentRunId,
    );
    const agentRunIds = assistantMsgs.map(m => m.agentRunId!);
    const agentRuns = await this.agentRunRepo.findByIds(agentRunIds);
    const activeIds = agentRuns
      .filter(r => r.status === 'initialized' || r.status === 'running')
      .map(r => r.id);
    return assistantMsgs.filter(m => activeIds.includes(m.agentRunId!));
  }

  /**
   * Mark active assistant messages as failed — updates AgentRun status only.
   * events 事实流不动（保留原貌），Message content 由调用方决定。
   */
  async markMessagesFailed(
    messages: Message[],
    fallbackContent: string,
  ): Promise<void> {
    await Promise.all(
      messages.map(msg =>
        this.messageRepo.update(msg.id, { content: fallbackContent }),
      ),
    );

    const agentRunIds = messages
      .map(m => m.agentRunId)
      .filter((id): id is string => !!id);

    if (agentRunIds.length > 0) {
      await Promise.all(
        agentRunIds.map(runId =>
          this.agentRunRepo.update(runId, {
            status: 'failed',
            completedAt: new Date(),
          }),
        ),
      );
    }
  }
}
