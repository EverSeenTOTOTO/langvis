import Logger from '@/server/utils/logger';
import { Inject, OnModuleInit } from '@nestjs/common';
import { ChatService } from './chat.service';

// 孤儿 run 清扫（启动用例）：服务重启后内存 activeRuns 丢失，DB 里残留的 initialized/running run 已死——启动时一次性把它们驱动到 failed。
export class OrphanRunReconciler implements OnModuleInit {
  private readonly logger = Logger.child({ source: 'OrphanRunReconciler' });

  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  async onModuleInit(): Promise<void> {
    const count = await this.chat.markInterruptedRuns(
      'Generation interrupted (server restarted)',
    );
    if (count > 0) {
      this.logger.warn(`Marked ${count} orphaned run(s) failed on boot`);
    }
  }
}
