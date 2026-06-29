import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import type { SSEFrame } from '@/shared/types/events';
import { SessionManager } from '../service/session-manager';
import { CONVERSATION_MEMORY_PORT } from '@/server/modules/memory';
import type { ConversationMemoryPort } from '@/server/modules/memory';
import { ConversationActivated } from '../../contracts';
import type { ConversationActivatedPayload } from '../../contracts';
import Logger from '@/server/utils/logger';

/**
 * ConversationActivatedUsageHandler —— 会话激活即下发会话层用量基线。
 *
 * ConversationMemory 归 memory（经 ConversationMemoryPort 暴露）；激活命令已 activate 它（灌入
 * 消息+配置），故此处直接取用量并发 conversation_usage 控制帧。激活事件在 SSE
 * initSession.attachTransport 之前发出，但本 getUsage 是同步端口调用、必晚于同步 attach——连接就绪。
 * 失败 best-effort 吞掉（用量不影响激活）。
 */
@eventHandler(ConversationActivated)
export class ConversationActivatedUsageHandler {
  private readonly logger = Logger.child({
    source: 'ConversationActivatedUsageHandler',
  });

  constructor(
    @inject(CONVERSATION_MEMORY_PORT)
    private convMemory: ConversationMemoryPort,
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async handle(
    event: DomainEvent<string, ConversationActivatedPayload>,
  ): Promise<void> {
    const { conversationId } = event.payload;
    try {
      const usage = this.convMemory.getUsage(conversationId);
      this.sessionManager.sendFrame(conversationId, {
        type: 'conversation_usage',
        used: usage.used,
        total: usage.total,
      } as SSEFrame);
    } catch (err) {
      this.logger.warn(
        `Seeding conversation usage failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
