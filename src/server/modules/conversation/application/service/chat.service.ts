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
import { composeConfigSchema } from '@/server/libs/config/config-fragment';
import { parse } from '@/server/utils/schemaValidator';
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

  /** start 前调用——不静默激活，让调用方显式先 activate（存在 SYSTEM 消息即视为已激活）。 */
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

  getConversationMessages(conversationId: string): Promise<Message[]> {
    return this.messageRepo.findByConversationId(conversationId);
  }

  async resolveConversationConfig(conversationId: string): Promise<{
    contextSize: number;
    runtimeConfig: Record<string, unknown>;
  } | null> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv) return null;

    const modelId =
      (conv.config?.model as { modelId?: string } | undefined)?.modelId ?? '';
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 0)
      : 0;
    return {
      contextSize,
      runtimeConfig: parse(composeConfigSchema(), conv.config) as Record<
        string,
        unknown
      >,
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

  /**
   * 全局清扫（启动用例）：把所有非终态 run（重启残留）批量标记 failed，并更新其 assistant 消息文案。
   * run 为权威——每个非终态 run 都落终态；消息可能缺失（崩溃早于落 agentRunId）则只更 run。
   * 不再补发 SSE 帧：DB 在接客前即修好，前端重连/重拉自然拿到终态。
   */
  async markInterruptedRuns(reason: string): Promise<number> {
    const runs = await this.agentRunRepo.findNonTerminal();
    if (runs.length === 0) return 0;

    const messages = await this.messageRepo.findByAgentRunIds(
      runs.map(r => r.id),
    );
    const now = new Date();
    await Promise.all([
      ...messages.map(m => this.messageRepo.update(m.id, { content: reason })),
      ...runs.map(r =>
        this.agentRunRepo.update(r.id, {
          status: 'failed',
          completedAt: now,
        }),
      ),
    ]);
    return runs.length;
  }
}
