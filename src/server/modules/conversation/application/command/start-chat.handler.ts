import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { StartChatCommand, TurnInitiated } from '../../contracts';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(EventBus)
    private eventBus: EventBus,
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, userId, assistantId } = command;

    // 持久化 + 归属校验 + systemPrompt 推导 在 ChatService.startTurn;
    // memory 与事件派发是 session 作用域 / I/O,留 handler。
    const turn = await this.chatService.startTurn({
      conversationId,
      userId,
      userMessage,
      assistantId,
    });

    const memory = this.sessionManager.getMemory(conversationId);
    memory.append(turn.userMessage);

    // 消费者 transform 数据源：按 history 中 assistant 消息的 agentRunId 批量取过程摘要（存于 AgentRun）
    const runIds = [
      ...new Set(
        memory
          .getMessages()
          .map(m => m.agentRunId)
          .filter((id): id is string => !!id),
      ),
    ];
    const runs = await this.agentRunRepo.findByIds(runIds);
    const processSummaries = new Map<string, string>();
    for (const run of runs) {
      if (run.processSummary) processSummaries.set(run.id, run.processSummary);
    }

    const effectiveHistory = await memory.buildContext(processSummaries);

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: turn.assistantMessage,
        userConfig: turn.userConfig,
        systemPrompt: turn.systemPrompt,
        effectiveHistory,
      }),
    );

    return { assistantId: turn.assistantMessage.id };
  }
}
