import type {
  Conversation,
  Message,
  MessageAttachment,
} from '@/shared/types/entities';
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
import {
  ConversationNotActivatedError,
  ConversationNotFoundError,
} from '../../domain/errors';
import Logger from '@/server/utils/logger';
import { isEmpty } from 'lodash-es';
import type { EnrichedEvent } from '@/shared/types/events';
import type { ConversationMemory } from '../../domain/model/conversation-memory';
import { projectRun } from './run-projection';

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

  /**
   * 加载并校验会话归属:repo 按 (id, userId) 过滤,不存在/非本人统一 NotFound
   * (不泄露存在性)。所有需要 ownership 的用例走这里,取代各 handler 各凭良心。
   */
  async requireConversation(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    const conversation = await this.convRepo.findById(conversationId, userId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return conversation;
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

  /**
   * 开 turn 的应用编排:校验归属 + 已激活 → 追加 user/assistant 消息 → 推导 systemPrompt。
   * memory 与事件派发留给 handler(session 作用域 + I/O 边界);此方法只做持久化与领域事实推导。
   */
  async startTurn(params: {
    conversationId: string;
    userId: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, unknown> | null;
    };
    assistantId?: string;
  }): Promise<{
    userMessage: Message;
    assistantMessage: Message;
    userConfig: Record<string, unknown>;
    systemPrompt: string;
  }> {
    const conversation = await this.requireConversation(
      params.conversationId,
      params.userId,
    );
    await this.assertActivated(params.conversationId);

    const setup = await this.appendMessage({
      conversationId: params.conversationId,
      userMessage: params.userMessage,
      assistantId: params.assistantId,
    });

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );

    return {
      userMessage: setup.userMessage,
      assistantMessage: setup.assistantMessage,
      userConfig: conversation.config ?? {},
      systemPrompt: systemMessage?.content ?? '',
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

    const modelId = (conv.config?.model as { modelId?: string } | undefined)
      ?.modelId;
    // 无显式 model 时回退默认 chat 模型：自动建会话(config={})否则落到 contextSize=0，
    // 进度量条分母为 0（恒显 100%）且历史压缩被 !contextSize 静默禁用。
    const { contextSize } = this.providerService.resolveChatModel(modelId);
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

  /**
   * 收 turn 的应用编排:把 run 事件流投影成终态 → 持久化 assistant 消息(processSummary/audio 入 meta)
   * → 历史压缩(超阈则落盘 compact 消息)。返回会话用量供 handler 发 conversation_usage 帧;
   * 返回 null 表示不发帧(压缩失败已兜底)。events 与 memory 由 handler 传入(session 作用域,
   * 不经此引入 ChatService→SessionManager 的环)。
   */
  async completeTurn(params: {
    conversationId: string;
    messageId: string;
    events: readonly EnrichedEvent[];
    memory: ConversationMemory;
  }): Promise<{ used: number; total: number } | null> {
    const view = projectRun(params.events);
    const meta: Record<string, unknown> = {};
    if (view.processSummary) meta.processSummary = view.processSummary;
    if (view.audio) meta.audio = view.audio;

    const assistantMessage = await this.messageRepo.update(
      params.messageId,
      isEmpty(meta)
        ? { content: view.content }
        : { content: view.content, meta },
    );

    try {
      if (assistantMessage) params.memory.append(assistantMessage);
      const result = await params.memory.compact(new AbortController().signal);
      if (result) {
        const [compactMessage] = await this.messageRepo.batchCreate(
          params.conversationId,
          [
            {
              role: Role.USER,
              content: result.content,
              meta: { kind: 'compact', startRef: result.startRef },
              createdAt: new Date(),
            },
          ],
        );
        params.memory.append(compactMessage);
        return { used: result.usage.used, total: result.usage.total };
      }
      const usage = params.memory.getContextUsage();
      return { used: usage.used, total: usage.total };
    } catch (err) {
      this.logger.warn(
        `Post-turn memory maintenance failed: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}
