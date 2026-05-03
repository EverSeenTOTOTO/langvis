import { RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { Message, MessageAttachment } from '@/shared/types/entities';
import { SessionPhase } from '@/shared/types';
import { generateId } from '@/shared/utils';
import { globby } from 'globby';
import { inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { MessageFSM } from '../core/MessageFSM';
import { SessionFSM } from '../core/SessionFSM';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { estimateTokens } from '../utils/estimateTokens';
import { ConversationService } from './ConversationService';
import { RedisService } from './RedisService';
import { ContextUsageService } from './ContextUsageService';
import { ProviderService } from './ProviderService';
import { WorkspaceService } from './WorkspaceService';

export interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}

export interface PrepareTurnResult {
  messages: import('@/shared/entities/Message').Message[];
  assistantId: string;
  assistantMessage: import('@/shared/entities/Message').Message;
}

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, SessionFSM>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(ContextUsageService)
    private contextUsageService: ContextUsageService,
    @inject(ProviderService) private providerService: ProviderService,
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/core/memory/*/index${suffix}`;

    globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    })
      .then(memoryPaths => {
        return Promise.all(
          memoryPaths.map(async memoryPath => {
            const { default: clazz } = await import(memoryPath);
            registerMemory(clazz);
          }),
        );
      })
      .catch(error => {
        this.logger.error('Failed to register memory modules:', error);
      });
  }

  getSession(conversationId: string): SessionFSM | undefined {
    return this.sessions.get(conversationId);
  }

  async getSessionState(
    conversationId: string,
  ): Promise<ChatSessionState | null> {
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }

  async updateSessionPhase(
    conversationId: string,
    phase: SessionPhase,
    agentId?: string,
  ): Promise<void> {
    const state = await this.getSessionState(conversationId);
    if (!state) return;
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { ...state, phase, agentId: agentId ?? state.agentId },
      3600,
    );
  }

  async acquireSession(conversationId: string): Promise<SessionFSM | null> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.logger.info(`Session reconnected`, {
        sessionId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    // Clean up stale Redis state from previous server instance
    await this.cleanupStaleState(conversationId);

    this.logger.info(`Session created`, { sessionId: conversationId });

    const session = new SessionFSM(conversationId, 30_000);

    session.addEventListener('dispose', (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      this.sessions.delete(id);
      this.redisService.del(RedisKeys.CHAT_SESSION(id));
    });

    session.addEventListener('transition', (e: Event) => {
      const { to } = (
        e as CustomEvent<{ from: SessionPhase; to: SessionPhase }>
      ).detail;
      this.updateSessionPhase(conversationId, to);
    });

    this.sessions.set(conversationId, session);

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

    return session;
  }

  private async cleanupStaleState(conversationId: string): Promise<void> {
    const state = await this.getSessionState(conversationId);
    if (!state) return;

    // Mark any non-terminal messages as error (server restarted mid-stream)
    if (state.phase !== 'done' && state.phase !== 'waiting') {
      this.logger.warn(`Stale session detected`, {
        sessionId: conversationId,
        phase: state.phase,
      });

      const staleMessages =
        await this.conversationService.findNonTerminalAssistantMessages(
          conversationId,
        );

      if (staleMessages.length > 0) {
        const errorEvent = {
          type: 'error' as const,
          messageId: 'zombie',
          error: 'Generation interrupted (server restarted)',
          seq: Date.now(),
          at: Date.now(),
        };

        await Promise.all(
          staleMessages.map(msg => {
            const events = msg.meta?.events ?? [];
            events.push(errorEvent);
            return this.conversationService.updateMessage(
              msg.id,
              msg.content || 'Generation interrupted (server restarted)',
              { ...msg.meta, events },
            );
          }),
        );
      }
    }

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
  }

  async prepareTurn(params: {
    conversationId: string;
    userId: string;
    systemPrompt: string;
    context?: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    };
    assistantId?: string;
  }): Promise<PrepareTurnResult> {
    const {
      conversationId,
      userId,
      systemPrompt,
      context,
      userMessage,
      assistantId: preGeneratedAssistantId,
    } = params;

    const existingMessages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );
    const isFirstTurn = existingMessages.length === 0;

    const baseTime = Date.now();
    let index = 0;
    const newMessages: Message[] = [];

    if (isFirstTurn) {
      newMessages.push({
        id: generateId('msg'),
        role: Role.SYSTEM,
        content: systemPrompt,
        attachments: null,
        meta: null,
        createdAt: new Date(baseTime + index++),
        conversationId,
      });

      const workDir = await this.workspaceService.getWorkDir(conversationId);
      const sessionContext = `<session-context>
Conversation ID: ${conversationId}
User ID: ${userId}
Workspace Directory: ${workDir}
</session-context>`;

      newMessages.push({
        id: generateId('msg'),
        role: Role.USER,
        content: sessionContext,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + index++),
        conversationId,
      });

      if (context) {
        newMessages.push({
          id: generateId('msg'),
          role: Role.USER,
          content: context,
          attachments: null,
          meta: { hidden: true },
          createdAt: new Date(baseTime + index++),
          conversationId,
        });
      }
    }

    newMessages.push({
      id: generateId('msg'),
      ...userMessage,
      createdAt: new Date(baseTime + index++),
      conversationId,
    });

    const assistantId = preGeneratedAssistantId ?? generateId('msg');
    const assistantMessage: import('@/shared/entities/Message').Message = {
      id: assistantId,
      role: Role.ASSIST,
      content: '',
      attachments: null,
      meta: null,
      createdAt: new Date(baseTime + index++),
      conversationId,
    };
    newMessages.push(assistantMessage);

    this.conversationService
      .batchAddMessages(conversationId, newMessages)
      .catch(err => {
        this.logger.error('Failed to persist turn messages', err);
      });

    return {
      messages: [...existingMessages, ...newMessages],
      assistantId,
      assistantMessage,
    };
  }

  async runSession(
    session: SessionFSM,
    agent: Agent,
    config: unknown,
    messageId: string,
  ): Promise<void> {
    const messageFSM = session.getMessageFSM(messageId);
    if (!messageFSM) {
      this.logger.error(`MessageFSM not found for ${messageId}`);
      return;
    }

    const memory = session.memory;
    if (!memory) {
      this.logger.error(`Memory not set for session ${session.conversationId}`);
      return;
    }

    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
      messageId,
    });

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(memory, messageFSM.ctx, config)) {
        if (messageFSM.ctx.signal.aborted) break;

        if (event.type === 'stream' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${session.conversationId}`,
          );
        }

        messageFSM.handleEvent(event);

        if (!session.send(event)) {
          this.logger.warn(
            `SSE not connected for ${session.conversationId}, event persisted`,
          );
        }

        if (event.type === 'error') break;
      }
    } catch (err) {
      if (messageFSM.ctx.signal.aborted) {
        this.logger.info(
          `Agent execution aborted session=${session.conversationId}`,
        );
      } else {
        this.handleAgentError(err, messageFSM, session);
      }
    } finally {
      if (messageFSM.ctx.signal.aborted) {
        this.handleAgentCancel(messageFSM, session);
      }

      await memory.completeTurn(messageFSM.message);

      await this.conversationService.updateMessage(
        messageFSM.message.id,
        messageFSM.message.content,
        messageFSM.message.meta,
      );

      await this.pushContextUsage(session, messageFSM);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = messageFSM.message.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${session.conversationId}`,
      );
    }
  }

  private async pushContextUsage(
    session: SessionFSM,
    messageFSM: MessageFSM,
  ): Promise<void> {
    const memory = session.memory;
    if (!memory) return;

    const messages = [...(await memory.summarize()), messageFSM.message];

    const modelId = (messageFSM.message as any).modelId as string | undefined;
    const model = modelId ? this.providerService.getModel(modelId) : undefined;

    if (!model?.contextSize) return;

    try {
      const used = estimateTokens(messages, modelId!);
      const total = model.contextSize;

      this.contextUsageService.set(session.conversationId, { used, total });

      session.send({
        type: 'context_usage',
        messageId: messageFSM.messageId,
        used,
        total,
        seq: Date.now(),
        at: Date.now(),
      });

      await memory.notifyContextUsage({ used, total });
    } catch (err) {
      this.logger.warn(
        `Failed to calculate context usage: ${(err as Error)?.message}`,
      );
    }
  }

  private handleAgentError(
    err: unknown,
    messageFSM: MessageFSM,
    session: SessionFSM,
  ): void {
    this.logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${session.conversationId}`,
    );
    const errorEvent = messageFSM.ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    messageFSM.handleEvent(errorEvent);
    session.send(errorEvent);
  }

  private handleAgentCancel(messageFSM: MessageFSM, session: SessionFSM): void {
    const reason =
      (messageFSM.ctx.signal.reason as Error)?.message ?? 'Unknown';
    this.logger.info(
      `Agent cancelled: ${reason} session=${session.conversationId}`,
    );
    const cancelledEvent = messageFSM.ctx.agentCancelledEvent(reason);
    messageFSM.handleEvent(cancelledEvent);
    session.send(cancelledEvent);
  }
}
