import type { Message, MessageAttachment } from '@/shared/types/entities';
import type { SSEFrame } from '@/shared/types/events';
import type { RunEvent } from '../domain/pending-message';
import { Role } from '@/shared/entities/Message';
import { RedisKeys } from '@/shared/constants';
import type { ChatPhase } from '@/shared/types';
import type { Transport } from '@/shared/transport';
import { inject, singleton } from 'tsyringe';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';
import type { MessageRepositoryPort } from '../database/message.repository.port';
import { Chat } from '../domain/chat';
import { SseConnection } from './sse-connection';
import type { AgentRun } from '@/server/modules/agent/domain/agent-run.entity';
import Logger from '@/server/utils/logger';

export interface ChatState {
  conversationId: string;
  phase: ChatPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}

@singleton()
export class ConversationService {
  private readonly logger = Logger.child({ source: 'ConversationService' });

  private chats = new Map<string, Chat>();
  private connections = new Map<string, SseConnection>();
  private activeRuns = new Map<string, Map<string, AgentRun>>();

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
    @inject(RedisService)
    private redisService: RedisService,
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

  async acquireChat(conversationId: string): Promise<Chat> {
    const existing = this.chats.get(conversationId);
    if (existing) {
      this.logger.info(`Chat reconnected`, {
        chatId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    await this.cleanupStaleState(conversationId);
    const chat = this.getOrCreateChat(conversationId);

    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      {
        conversationId,
        phase: 'waiting',
        messages: [],
        startedAt: Date.now(),
        agentId: null,
      },
      3600,
    );

    return chat;
  }

  disposeChat(conversationId: string): void {
    const conv = this.chats.get(conversationId);
    if (!conv) return;
    conv.dispose();
    this.handleDomainEvents(conv);
  }

  /** 初始化会话：acquireChat + attachTransport + dispose 回调 */
  initSession(conversationId: string, transport: Transport<SSEFrame>): void {
    this.acquireChat(conversationId);
    this.attachTransport(conversationId, transport, () =>
      this.disposeChat(conversationId),
    );
  }

  async disposeAll(): Promise<void> {
    const count = this.chats.size;
    for (const [id, conversation] of this.chats) {
      conversation.dispose();
      this.handleDomainEvents(conversation);
      this.connections.get(id)?.dispose();
    }
    this.logger.info(`Closed ${count} SSE connections`);
  }

  /** 处理 AgentRun 事件：累积 PendingMessage + 投递 SSE 帧 */
  processRunEvent(conversationId: string, event: RunEvent): void {
    const chat = this.chats.get(conversationId);
    if (!chat) return;
    chat.handleRunEvent(event);
    const snapshot = chat.getPendingSnapshot();
    const frame = { ...event, messageId: snapshot?.messageId } as SSEFrame;
    this.connections.get(conversationId)?.send(frame);
  }

  attachTransport(
    conversationId: string,
    transport: Transport<SSEFrame>,
    onIdle?: () => void,
  ): void {
    let conn = this.connections.get(conversationId);
    if (!conn) {
      conn = new SseConnection(conversationId, 30_000, () => {
        this.connections.delete(conversationId);
        onIdle?.();
      });
      this.connections.set(conversationId, conn);
    }
    conn.attach(transport);

    // replay: 从 PendingMessage snapshot 恢复
    const conv = this.chats.get(conversationId);
    const snapshot = conv?.getPendingSnapshot();
    if (snapshot && snapshot.status === 'running') {
      conn.send({
        type: 'state_snapshot',
        messageId: snapshot.messageId,
        content: snapshot.content,
        steps: snapshot.steps,
      } as SSEFrame);
      this.logger.info(
        `Replayed snapshot: ${snapshot.content.length} chars, ${snapshot.steps.length} steps`,
        { chatId: conversationId, messageId: snapshot.messageId },
      );
    }

    this.logger.info(`Transport attached`, {
      chatId: conversationId,
    });
  }

  sendFrame(conversationId: string, frame: SSEFrame): boolean {
    return this.connections.get(conversationId)?.send(frame) ?? false;
  }

  // ════════════════════════════════════════
  // Run 管理（从 SessionManager 搬入）
  // ════════════════════════════════════════

  registerRun(conversationId: string, messageId: string, run: AgentRun): void {
    if (!this.activeRuns.has(conversationId)) {
      this.activeRuns.set(conversationId, new Map());
    }
    this.activeRuns.get(conversationId)!.set(messageId, run);
  }

  finalizeRun(conversationId: string, messageId: string): void {
    const runs = this.activeRuns.get(conversationId);
    if (!runs) return;
    runs.delete(messageId);
    if (runs.size === 0) {
      this.activeRuns.delete(conversationId);
      const conn = this.connections.get(conversationId);
      if (conn) {
        conn.markIdle();
      } else {
        // Headless run (no SSE connection) — dispose Chat immediately
        const conv = this.chats.get(conversationId);
        if (conv) {
          conv.dispose();
          this.handleDomainEvents(conv);
        }
      }
    }
  }

  cancelActiveRun(
    conversationId: string,
    messageId: string,
    reason: string,
  ): void {
    const run = this.activeRuns.get(conversationId)?.get(messageId);
    if (run && !run.isTerminated) {
      try {
        run.cancel(reason);
      } catch {
        // Already terminated
      }
    }
  }

  // ════════════════════════════════════════
  // Redis session state（从 SessionManager 搬入）
  // ════════════════════════════════════════

  async getChatState(conversationId: string): Promise<ChatState | null> {
    return this.redisService.get<ChatState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }

  /**
   * 处理聚合根收集的领域事件。
   * 在每次 conversation 操作后调用。
   */
  handleDomainEvents(conversation: Chat): void {
    for (const event of conversation.domainEvents) {
      switch (event.type) {
        case 'phase_changed': {
          const { to } = event.payload as {
            from: ChatPhase;
            to: ChatPhase;
          };
          this.updateChatPhase(event.aggregateId, to);
          break;
        }
        case 'conversation_disposed': {
          this.chats.delete(event.aggregateId);
          this.activeRuns.delete(event.aggregateId);
          this.redisService.del(RedisKeys.CHAT_SESSION(event.aggregateId));
          break;
        }
      }
    }
    conversation.clearEvents();
  }

  // ── 内部 ──

  private async updateChatPhase(
    conversationId: string,
    phase: ChatPhase,
    agentId?: string,
  ): Promise<void> {
    const state = await this.getChatState(conversationId);
    if (!state) return;
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { ...state, phase, agentId: agentId ?? state.agentId },
      3600,
    );
  }

  private async cleanupStaleState(conversationId: string): Promise<void> {
    const state = await this.getChatState(conversationId);
    if (!state) return;

    if (state.phase !== 'done' && state.phase !== 'waiting') {
      this.logger.warn(`Stale session detected`, {
        chatId: conversationId,
        phase: state.phase,
      });

      const staleMessages =
        await this.messageRepo.findActiveAssistantMessages(conversationId);

      if (staleMessages.length > 0) {
        await Promise.all(
          staleMessages.map(msg =>
            this.messageRepo.update(msg.id, {
              content:
                msg.content || 'Generation interrupted (server restarted)',
              status: 'failed',
            }),
          ),
        );
      }
    }

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
  }
}
