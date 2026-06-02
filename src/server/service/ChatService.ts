import { RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { Message, MessageAttachment } from '@/shared/types/entities';
import type { SessionPhase } from '@/shared/types';
import type { SSEFrame } from '@/shared/types/events';
import type { AgentBinding } from '@/shared/types/agent';
import { generateId } from '@/shared/utils';
import { container, inject } from 'tsyringe';
import type { Agent } from '../modules/agent/domain/agent.base';
import { AgentRun } from '../modules/agent/domain/agent-run.entity';
import { resolveEffectiveConfig } from '../modules/agent/domain/effective-config';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import { MEMORY_SERVICE, CACHE_PORT } from '../modules/agent/agent.di-tokens';
import type { MemoryService } from '../modules/memory/domain/memory-service';
import type { CachePort } from '../modules/memory/ports/cache.port';
import { Conversation } from '../modules/conversation';
import { service } from '../decorator/service';
import Logger from '../utils/logger';
import { ConversationService } from './ConversationService';
import { RedisService } from './RedisService';
import { WorkspaceService } from './WorkspaceService';
import { ProviderService } from './ProviderService';

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
  private sessions = new Map<string, Conversation>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
    @inject(ProviderService) private providerService: ProviderService,
  ) {}

  getSession(conversationId: string): Conversation | undefined {
    return this.sessions.get(conversationId);
  }

  async dispose(): Promise<void> {
    const count = this.sessions.size;
    for (const conversation of this.sessions.values()) {
      conversation.dispose();
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

  async acquireSession(conversationId: string): Promise<Conversation | null> {
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

    const conversation = new Conversation(conversationId, {
      idleTimeoutMs: 30_000,
      onDispose: id => {
        this.sessions.delete(id);
        this.redisService.del(RedisKeys.CHAT_SESSION(id));
      },
      onPhaseChange: (id, phase) => {
        this.updateSessionPhase(id, phase);
      },
    });

    this.sessions.set(conversationId, conversation);

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

    return conversation;
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
              status: 'failed',
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

  async startRun(params: {
    conversationId: string;
    agent: Agent;
    messages: Message[];
    assistantMessage: Message;
    binding: AgentBinding;
  }): Promise<AgentRun> {
    const conversation = this.sessions.get(params.conversationId);
    if (!conversation) throw new Error('No session');

    const effectiveConfig = resolveEffectiveConfig(
      params.agent.config,
      params.binding,
      this.providerService,
      params.agent.systemPrompt.build(),
    );

    const memoryService = container.resolve<MemoryService>(MEMORY_SERVICE);
    const cachePort = container.resolve<CachePort>(CACHE_PORT);

    const run = new AgentRun(
      generateId('run'),
      params.assistantMessage.id,
      effectiveConfig,
      memoryService,
      cachePort,
      params.messages,
    );

    conversation.registerRun(params.assistantMessage, run);

    this.conversationService
      .updateMessage(params.assistantMessage.id, {
        agentRunId: run.runId,
      })
      .catch(err => {
        this.logger.warn('Failed to persist agentRunId', err);
      });

    return run;
  }

  async runSession(
    conversation: Conversation,
    agent: Agent,
    run: AgentRun,
  ): Promise<void> {
    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: conversation.id,
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
            `First token: ttft=${firstTokenTime - startTime}ms session=${conversation.id}`,
          );
        }

        const frame = { ...event, messageId: run.messageId } as SSEFrame;

        if (!conversation.send(frame)) {
          this.logger.warn(
            `SSE not connected for ${conversation.id}, event persisted`,
          );
        }

        this.projectToMessage(event, run.messageId, run).catch(err => {
          this.logger.warn(
            'Projection failed, will be corrected by final write',
            {
              messageId: run.messageId,
              eventType: event.type,
              error: (err as Error)?.message,
            },
          );
        });

        if (event.type === 'error') break;
      }
    } catch (err) {
      if (run.signal.aborted) {
        this.logger.info(`Agent execution aborted session=${conversation.id}`);
      } else {
        this.logger.error(`Agent error session=${conversation.id}`, {
          error: (err as Error)?.message || String(err),
          stack: (err as Error)?.stack,
        });
        const errEvent = run.fail((err as Error)?.message || String(err));
        conversation.send({
          ...errEvent,
          messageId: run.messageId,
        } as SSEFrame);
      }
    } finally {
      if (run.signal.aborted && !run.isTerminated) {
        try {
          const reason = (run.signal.reason as Error)?.message ?? 'Cancelled';
          const cancelEvent = run.cancel(reason);
          conversation.send({
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
      conversation.send(usageFrame);

      // Persist final message state
      await this.conversationService.updateMessage(run.messageId, {
        content: run.content,
        toolCallRecords: run.getToolCallRecords(),
        thoughts: run.toSnapshot().thoughts,
        agentRunId: run.runId,
        status: run.status,
      });

      // Finalize run in conversation
      conversation.finalizeRun(run.messageId);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = run.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${conversation.id}`,
      );
    }
  }

  private async projectToMessage(
    event: AgentEvent | StreamChunk,
    messageId: string,
    run: AgentRun,
  ): Promise<void> {
    switch (event.type) {
      case 'tool_result':
      case 'tool_error': {
        const toolCall = run.getToolCall(event.callId);
        if (toolCall) {
          await this.conversationService.appendToolCallRecord(
            messageId,
            toolCall.toRecord(),
          );
        }
        break;
      }
      case 'thought': {
        await this.conversationService.appendThought(messageId, event.content);
        break;
      }
    }
  }
}
