import type { StreamFrame } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import logger from '@/server/utils/logger';

/** 传输层连接管理器：多标签页并发连接，向所有活跃连接广播；空闲超时后自动回收。 */
export class Connection {
  private transports = new Set<Transport<StreamFrame>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeout: number;
  private readonly onDispose: () => void;
  private readonly canDispose: () => boolean;

  get connectedCount(): number {
    return this.transports.size;
  }

  constructor(
    readonly conversationId: string,
    idleTimeout: number,
    onDispose: () => void,
    /** 是否允许 idle 自释放——有活跃 run 时由调用方置 false，避免释放正在执行的会话。 */
    canDispose: () => boolean = () => true,
  ) {
    this.idleTimeout = idleTimeout;
    this.onDispose = onDispose;
    this.canDispose = canDispose;
  }

  attach(transport: Transport<StreamFrame>): void {
    this.transports.add(transport);
    this.clearIdleTimer();

    transport.addEventListener('disconnect', () => {
      this.transports.delete(transport);
      if (this.transports.size === 0) {
        this.resetIdleTimer();
      }
    });
  }

  send(frame: StreamFrame): boolean {
    if (this.transports.size === 0) return false;

    let anySent = false;
    for (const transport of this.transports) {
      if (transport.isConnected) {
        transport.send(frame);
        anySent = true;
      }
    }
    return anySent;
  }

  markIdle(): void {
    if (this.transports.size === 0) {
      this.resetIdleTimer();
    }
  }

  dispose(): void {
    this.clearIdleTimer();

    for (const transport of this.transports) {
      transport.close();
    }
    this.transports.clear();

    this.onDispose();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      // 有活跃 run 时拒绝释放——run 完成后 finalizeRun→markIdle 会重新计时回收。
      if (!this.canDispose()) {
        logger.info(`Connection idle deferred — active run in flight`, {
          sessionId: this.conversationId,
        });
        return;
      }
      logger.info(`Connection idle timeout after ${this.idleTimeout}ms`, {
        sessionId: this.conversationId,
      });
      this.dispose();
    }, this.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
