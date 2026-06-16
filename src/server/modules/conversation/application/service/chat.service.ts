import type { Message, MessageAttachment } from '@/shared/types/entities';
import type { ChatPhase } from '@/shared/types';
import { Role } from '@/shared/entities/Message';
import { inject, singleton } from 'tsyringe';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { Chat } from '../../domain/model/chat';
import { EventBus } from '@/server/libs/ddd';
import { TurnCancellationRequested } from '../../contracts';
import Logger from '@/server/utils/logger';

@singleton()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });

  private chats = new Map<string, Chat>();

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  // ════════════════════════════════════════
  // 聚合根生命周期
  // ════════════════════════════════════════

  getOrCreateChat(conversationId: string): Chat {
    let chat = this.chats.get(conversationId);
    if (!chat) {
      chat = new Chat(conversationId);
      this.chats.set(conversationId, chat);
      this.logger.info(`Chat created`, { chatId: conversationId });
    }
    return chat;
  }

  getChat(conversationId: string): Chat | undefined {
    return this.chats.get(conversationId);
  }

  *allChats(): IterableIterator<[string, Chat]> {
    for (const entry of this.chats) {
      yield entry;
    }
  }

  // ════════════════════════════════════════
  // Turn 生命周期
  // ════════════════════════════════════════

  /**
   * 启动 turn — 调用方负责：
   * 1. sessionManager.syncInfrastructure(chat)（infra 反应）
   * 2. chat.clearEvents()
   */
  startTurn(conversationId: string, messageId: string): Chat {
    const chat = this.getOrCreateChat(conversationId);
    chat.startTurn(messageId);
    return chat;
  }

  /**
   * 完成 turn — 调用方负责 syncInfrastructure + clearEvents
   */
  completeTurn(conversationId: string, messageId: string): Chat | undefined {
    const chat = this.chats.get(conversationId);
    if (!chat) return undefined;
    chat.completeTurn(messageId);
    return chat;
  }

  /**
   * 取消 turn — dispatch TurnCancellationRequested 到 EventBus。
   * 调用方额外负责 syncInfrastructure + clearEvents
   */
  requestCancellation(
    conversationId: string,
    messageId?: string,
    reason?: string,
  ): Chat | undefined {
    const chat = this.chats.get(conversationId);
    if (!chat) return undefined;
    chat.requestCancellation(messageId, reason);
    for (const event of chat.domainEvents) {
      if (event.type === 'turn_cancellation_requested') {
        this.eventBus.dispatch(TurnCancellationRequested, event);
      }
    }
    return chat;
  }

  // ════════════════════════════════════════
  // 消息构建（通过 Chat 聚合根）
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

    const chat = this.getOrCreateChat(params.conversationId);
    const workDir = await this.workspaceService.getWorkDir(
      params.conversationId,
    );
    const messages = chat.createActivationMessages({ ...params, workDir });
    await this.messageRepo.batchCreate(params.conversationId, messages);
  }

  async appendMessage(params: {
    conversationId: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
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

    const chat = this.getOrCreateChat(params.conversationId);
    const { userMessage, assistantMessage } = chat.createTurnMessages(params);
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

  async persistPendingMessage(
    conversationId: string,
    messageId: string,
    agentRunId: string,
  ): Promise<void> {
    const chat = this.chats.get(conversationId);
    if (!chat) return;
    const snapshot = chat.getSnapshot(messageId);
    if (snapshot) {
      await this.messageRepo.update(messageId, {
        content: snapshot.content,
        steps: snapshot.steps,
        agentRunId,
        status: snapshot.status,
      });
    }
  }

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

  async findActiveAssistantMessages(
    conversationId: string,
  ): Promise<Message[]> {
    return this.messageRepo.findActiveAssistantMessages(conversationId);
  }

  async markMessagesFailed(
    ids: string[],
    fallbackContent: string,
  ): Promise<void> {
    await Promise.all(
      ids.map(id =>
        this.messageRepo.update(id, {
          content: fallbackContent,
          status: 'failed',
        }),
      ),
    );
  }

  // ════════════════════════════════════════
  // 聚合状态查询
  // ════════════════════════════════════════

  getPhase(conversationId: string): ChatPhase | undefined {
    return this.chats.get(conversationId)?.phase;
  }

  hasActiveMessage(conversationId: string, messageId: string): boolean {
    return this.chats.get(conversationId)?.hasActiveMessage(messageId) ?? false;
  }
}
