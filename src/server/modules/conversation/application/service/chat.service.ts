import type { Message, MessageAttachment } from '@/shared/types/entities';
import type { RunStatus } from '@/shared/types/agent';
import { Role } from '@/shared/entities/Message';
import { inject, singleton } from 'tsyringe';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import {
  createActivationMessages,
  createTurnMessages,
} from '../../domain/service/message-factory';
import { extractUserConfig } from '../../contracts';
import { ConversationNotActivatedError } from '../../domain/errors';
import Logger from '@/server/utils/logger';

@singleton()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
    @inject(ProviderService)
    private providerService: ProviderService,
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

  /**
   * 前置条件：会话必须已激活（存在 SYSTEM 消息）。
   * start 前调用 —— 不再静默激活，让调用方显式先 activate。
   */
  async assertActivated(conversationId: string): Promise<void> {
    const messages =
      await this.messageRepo.findByConversationId(conversationId);
    if (!messages.some(m => m.role === Role.SYSTEM)) {
      throw new ConversationNotActivatedError(conversationId);
    }
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
    userMessage: Message;
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
      userMessage,
      assistantId: assistantMessage.id,
      assistantMessage,
    };
  }

  // ════════════════════════════════════════
  // 持久化辅助
  // ════════════════════════════════════════

  /** 会话全部消息（供 ConversationMemoryPort.activate 一次性灌入）。 */
  getConversationMessages(conversationId: string): Promise<Message[]> {
    return this.messageRepo.findByConversationId(conversationId);
  }

  /** 会话配置（contextSize / modelId / runtimeConfig；供 ConversationMemoryPort.activate）。 */
  async resolveConversationConfig(conversationId: string): Promise<{
    contextSize: number;
    modelId: string;
    runtimeConfig: Record<string, unknown>;
  } | null> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv) return null;
    const modelId =
      (extractUserConfig(conv).model as { modelId?: string } | undefined)
        ?.modelId ?? '';
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 0)
      : 0;
    return {
      contextSize,
      modelId,
      runtimeConfig: (conv.config ?? {}) as Record<string, unknown>,
    };
  }

  persistAgentRunId(messageId: string, agentRunId: string): void {
    this.messageRepo.update(messageId, { agentRunId }).catch(err => {
      this.logger.warn('Failed to persist agentRunId', err);
    });
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
   * 终止活跃的 assistant 消息——更新 Message content 与 AgentRun status。
   * events 事实流不动（保留原貌），终态与文案由调用方决定：
   * 服务重启残留 → failed + 'Generation interrupted'；用户取消孤儿 → cancelled + reason。
   */
  async markMessagesTerminated(
    messages: Message[],
    status: RunStatus,
    content: string,
  ): Promise<void> {
    await Promise.all(
      messages.map(msg => this.messageRepo.update(msg.id, { content })),
    );

    const agentRunIds = messages
      .map(m => m.agentRunId)
      .filter((id): id is string => !!id);

    if (agentRunIds.length > 0) {
      await Promise.all(
        agentRunIds.map(runId =>
          this.agentRunRepo.update(runId, {
            status,
            completedAt: new Date(),
          }),
        ),
      );
    }
  }
}
