import Logger from '@/server/utils/logger';
import type { EnrichedEvent } from '@/shared/types/events';

/** 单次 run 的 tool 延迟埋点：tool_call 起表，tool_result/tool_error 收表打日志；兼计迭代数。 */
export class ToolLatencyTracker {
  private readonly starts = new Map<string, number>();
  private count = 0;
  constructor(private readonly logger: typeof Logger) {}

  observe(event: EnrichedEvent): void {
    if (event.type === 'tool_call') {
      this.count++;
      this.starts.set(event.callId, event.at);
      return;
    }
    if (event.type === 'tool_result') {
      const beganAt = this.starts.get(event.callId);
      this.starts.delete(event.callId);
      this.logger.debug(`Tool ${event.toolName} completed`, {
        toolName: event.toolName,
        durationMs: beganAt != null ? event.at - beganAt : undefined,
      });
      return;
    }
    if (event.type === 'tool_error') {
      const beganAt = this.starts.get(event.callId);
      this.starts.delete(event.callId);
      this.logger.warn(`Tool ${event.toolName} failed`, {
        toolName: event.toolName,
        callId: event.callId,
        error: event.error,
        durationMs: beganAt != null ? event.at - beganAt : undefined,
      });
    }
  }

  get iterations(): number {
    return this.count;
  }
}
