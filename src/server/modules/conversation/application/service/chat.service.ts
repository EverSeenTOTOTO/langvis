import { promises as fs } from 'fs';
import type {
  Conversation,
  Message,
  MessageAttachment,
} from '@/shared/types/entities';
import type { RunStatus } from '@/shared/types/agent';
import { Role } from '@/shared/entities/Message';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { projectRun } from './run-projection';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/server/infrastructure/database/transaction.port';
import {
  createActivationMessages,
  createTurnMessages,
} from '../../domain/service/message-factory';
import {
  configSchema,
  type ConversationConfig,
} from '@/server/modules/conversation/domain/config';
import { parse } from '@/server/utils/schemaValidator';
import { ConversationNotFoundError } from '../../domain/errors';
import { Inject } from '@nestjs/common';
import Logger from '@/server/utils/logger';

export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @Inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @Inject(TRANSACTION_PORT)
    private readonly tx: TransactionPort,
    @Inject(WorkspaceService)
    private workspaceService: WorkspaceService,
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

    const workDir = await this.resolveWorkDir(
      params.conversationId,
      params.userId,
    );
    const environment =
      await this.workspaceService.environmentSnapshot(workDir);
    const messages = createActivationMessages({
      ...params,
      workDir,
      environment,
    });
    await this.messageRepo.batchCreate(params.conversationId, messages);
  }

  /** workDir = conversation.workspacePath(CLI cwd / web 临时路径);null 老会话回退 /tmp 现算。 */
  // workspacePath 每会话不可变——进程内缓存命中零 DB 往返（远程隧道 RTT 可观）。老会话 null 走 legacy 不缓存。
  private readonly workDirCache = new Map<string, string>();

  async resolveWorkDir(
    conversationId: string,
    userId: string,
  ): Promise<string> {
    const cached = this.workDirCache.get(conversationId);
    if (cached) return cached;
    const conv = await this.convRepo.findById(conversationId, userId);
    if (conv?.workspacePath) {
      await fs.mkdir(conv.workspacePath, { recursive: true });
      this.workDirCache.set(conversationId, conv.workspacePath);
      return conv.workspacePath;
    }
    return this.workspaceService.getWorkDir(conversationId);
  }

  // 加载并校验会话归属:repo 按 (id, userId) 过滤,不存在/非本人统一 NotFound (不泄露存在性)。所有需要 ownership 的用例走这里,取代各 handler 各凭良心。
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
    userMessage: Message;
    assistantId: string;
    assistantMessage: Message;
  }> {
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
      userMessage,
      assistantId: assistantMessage.id,
      assistantMessage,
    };
  }

  // 开 turn 编排：校验归属 → 追加 user/assistant 消息。激活由客户端 /activate 保证先行，此处不再探针校验。
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
  }> {
    const conversation = await this.requireConversation(
      params.conversationId,
      params.userId,
    );

    const setup = await this.appendMessage({
      conversationId: params.conversationId,
      userMessage: params.userMessage,
      assistantId: params.assistantId,
    });

    return {
      userMessage: setup.userMessage,
      assistantMessage: setup.assistantMessage,
      userConfig: conversation.config ?? {},
    };
  }

  getConversationMessages(conversationId: string): Promise<Message[]> {
    return this.messageRepo.findByConversationId(conversationId);
  }

  /** steering 出队：按 assistantMessageId 找 (user, assistant) 消息对——turn 已在排队时持久化。 */
  async listPendingTurns(
    conversationId: string,
    assistantIds: string[],
  ): Promise<{
    turns: Array<{ userMessage: Message; assistantMessage: Message }>;
    workDir: string;
  }> {
    const [messages, workDir] = await Promise.all([
      this.messageRepo.findByConversationId(conversationId),
      this.getConversationWorkspace(conversationId),
    ]);
    const turns: Array<{ userMessage: Message; assistantMessage: Message }> =
      [];
    for (const id of assistantIds) {
      const idx = messages.findIndex(m => m.id === id);
      if (idx < 1) continue;
      const assistant = messages[idx]!;
      // user 消息紧邻其前（appendMessage 的顺序保证）
      const user = messages[idx - 1]!;
      if (user.role === Role.USER) {
        turns.push({ userMessage: user, assistantMessage: assistant });
      }
    }
    return { turns, workDir };
  }

  /** workspace 路径（steering 出队发起 TurnInitiated 用；无 workspace 返回会话工作目录）。 */
  private async getConversationWorkspace(
    conversationId: string,
  ): Promise<string> {
    const conv = await this.convRepo.findById(conversationId);
    if (conv?.workspacePath) {
      await fs.mkdir(conv.workspacePath, { recursive: true });
      return conv.workspacePath;
    }
    return this.workspaceService.getWorkDir(conversationId);
  }

  /** 按消息 id 批量删除（retry 截断用）：保留目标之前的历史，含目标本身 + 其后消息。 */
  deleteMessages(conversationId: string, messageIds: string[]): Promise<void> {
    return this.messageRepo.batchDeleteInConversation(
      conversationId,
      messageIds,
    );
  }

  /** 解析会话配置为 runtimeConfig（configSchema 全量 parse，边界处一次 as）。contextSize 不在此——按需派生。 */
  async resolveConversationConfig(
    conversationId: string,
  ): Promise<ConversationConfig | null> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv) return null;
    return parse(configSchema, conv.config) as ConversationConfig;
  }

  async persistAgentRunId(messageId: string, agentRunId: string) {
    try {
      await this.messageRepo.update(messageId, { agentRunId });
    } catch (err) {
      this.logger.warn('Failed to persist agentRunId', err);
    }
  }

  // Find assistant messages with active agent runs (Message + AgentRun repos).
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

  // 终止活跃 assistant 消息：更新 content 与 status。终态与文案由调用方决定（failed + 原因 / cancelled + reason）。
  async markMessagesTerminated(
    messages: Message[],
    status: RunStatus,
    content: string,
  ): Promise<void> {
    const now = new Date();
    const agentRunIds = messages
      .map(m => m.agentRunId)
      .filter((id): id is string => !!id);

    // 跨 message+run 两表多写须原子：任一抛错（含乐观锁冲突）回滚，不留半截状态。
    // 同一 queryrunner 不支持并发查询 → 事务内顺序写（孤儿数 N 通常 0–很小，代价可忽略）。
    await this.tx.transaction(async () => {
      for (const msg of messages) {
        await this.messageRepo.update(msg.id, { content });
      }
      for (const runId of agentRunIds) {
        await this.agentRunRepo.update(runId, { status, completedAt: now });
      }
    });
  }

  // 全局清扫（启动用例）：重启残留 run 批量标 failed；有中途 checkpoint 事件的 run 文案用投影的部分回复，否则回退 reason。
  async markInterruptedRuns(reason: string): Promise<number> {
    const runs = await this.agentRunRepo.findNonTerminal();
    if (runs.length === 0) return 0;

    const messages = await this.messageRepo.findByAgentRunIds(
      runs.map(r => r.id),
    );
    const byRunId = new Map(runs.map(r => [r.id, r] as const));
    const now = new Date();
    // 跨 message+run 两表多写须原子：任一抛错回滚。读 phase 留事务外（启动清扫幂等）。
    await this.tx.transaction(async () => {
      for (const r of runs) {
        await this.agentRunRepo.update(r.id, {
          status: 'failed',
          completedAt: now,
        });
      }
      for (const m of messages) {
        const run = m.agentRunId ? byRunId.get(m.agentRunId) : undefined;
        const projected = run?.events?.length
          ? projectRun(run.events).content
          : '';
        await this.messageRepo.update(m.id, { content: projected || reason });
      }
    });
    return runs.length;
  }

  // 收 turn 持久化接缝：落库 assistant 消息文案。content 取自 live view，与实时流/历史读回同源，audio 由 GetMessagesHandler 复算。
  async persistAssistantContent(
    messageId: string,
    content: string,
  ): Promise<Message | null> {
    return this.messageRepo.update(messageId, { content });
  }
}
