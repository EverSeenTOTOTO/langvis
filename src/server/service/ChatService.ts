import { RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { Message, MessageAttachment } from '@/shared/types/entities';
import type { SessionPhase } from '@/shared/types';
import type { SSEFrame } from '@/shared/types/events';
import { generateId } from '@/shared/utils';
import { inject } from 'tsyringe';
import type { Agent } from '../modules/agent/domain/agent.base';
import type { AgentRun } from '../modules/agent/domain/agent-run.entity';
import { SessionFSM } from '../core/SessionFSM';
import { service } from '../decorator/service';
import Logger from '../utils/logger';
import { ConversationService } from './ConversationService';
import { RedisService } from './RedisService';
import { WorkspaceService } from './WorkspaceService';

export interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}

export interface PrepareTurnResult {
  messages: Message[];
  assistantId: string;
  assistantMessage: Message;
}

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, SessionFSM>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {}

  getSession(conversationId: string): SessionFSM | undefined {
    return this.sessions.get(conversationId);
  }

  async dispose(): Promise<void> {
    const count = this.sessions.size;
    for (const session of this.sessions.values()) {
      await session.cleanup();
    }
    this.logger.info(`Closed ${count} SSE sessions`);
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

    if (state.phase !== 'done' && state.phase !== 'waiting') {
      this.logger.warn(`Stale session detected`, {
        sessionId: conversationId,
        phase: state.phase,
      });

      const staleMessages =
        await this.conversationService.findActiveAssistantMessages(
          conversationId,
        );

      if (staleMessages.length > 0) {
        await Promise.all(
          staleMessages.map(msg =>
            this.conversationService.updateMessage(msg.id, {
              content:
                msg.content || 'Generation interrupted (server restarted)',
              status: 'error',
            }),
          ),
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
    const assistantMessage: Message = {
      id: assistantId,
      role: Role.ASSIST,
      content: '',
      attachments: null,
      events: null,
      status: 'initialized',
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
      messages: [...existingMessages, ...newMessages.slice(0, -1)],
      assistantId,
      assistantMessage,
    };
  }

  async runSession(
    session: SessionFSM,
    agent: Agent,
    run: AgentRun,
  ): Promise<void> {
    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
      messageId: run.messageId,
    });

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(run)) {
        if (run.signal.aborted) break;

        if (event.type === 'text_chunk' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${session.conversationId}`,
          );
        }

        const frame = { ...event, messageId: run.messageId } as SSEFrame;

        if (!session.send(frame)) {
          this.logger.warn(
            `SSE not connected for ${session.conversationId}, event persisted`,
          );
        }

        if (event.type === 'error') break;
      }
    } catch (err) {
      if (run.signal.aborted) {
        this.logger.info(
          `Agent execution aborted session=${session.conversationId}`,
        );
      } else {
        this.logger.error(`Agent error session=${session.conversationId}`, {
          error: (err as Error)?.message || String(err),
          stack: (err as Error)?.stack,
        });
        const errEvent = run.fail((err as Error)?.message || String(err));
        session.send({ ...errEvent, messageId: run.messageId } as SSEFrame);
      }
    } finally {
      if (run.signal.aborted && !run.isTerminated) {
        try {
          const reason = (run.signal.reason as Error)?.message ?? 'Cancelled';
          const cancelEvent = run.cancel(reason);
          session.send({
            ...cancelEvent,
            messageId: run.messageId,
          } as SSEFrame);
        } catch {
          // Already terminated
        }
      }

      // Emit context_usage
      const usage = run.getContextUsage();
      const usageFrame: SSEFrame = {
        type: 'context_usage',
        messageId: run.messageId,
        seq: run.nextSeq(),
        at: Date.now(),
        used: usage.used,
        total: usage.total,
        reason: 'turn_completed',
      };
      session.send(usageFrame);

      // Persist final message state
      await this.conversationService.updateMessage(run.messageId, {
        content: run.content,
        toolCallRecords: run.getToolCallRecords(),
        thoughts: run.toSnapshot().thoughts,
        status:
          run.status === 'completed'
            ? 'final'
            : run.status === 'cancelled'
              ? 'canceled'
              : 'error',
      });

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = run.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${session.conversationId}`,
      );
    }
  }
}
