import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { ConversationDisposed } from '@/server/modules/conversation/contracts';
import { BackgroundTaskRegistry } from '../service/background-task-registry';

// 会话释放 → 清理 agent 域的会话级运行态（后台 bash 任务），不留孤儿进程。
// conv 侧只发事件（session-manager.disposeChat），不触达 agent 实现。
@EventsHandler(ConversationDisposed)
export class ConversationDisposedHandler implements IEventHandler {
  constructor(
    @Inject(BackgroundTaskRegistry)
    private readonly backgroundTasks: BackgroundTaskRegistry,
  ) {}

  async handle(event: ConversationDisposed): Promise<void> {
    this.backgroundTasks.disposeConversation(event.aggregateId);
  }
}
