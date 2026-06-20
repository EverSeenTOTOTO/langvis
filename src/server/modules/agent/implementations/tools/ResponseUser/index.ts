import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';

export interface ResponseUserInput {
  message: string;
}

export interface ResponseUserOutput {
  delivered: boolean;
}

/**
 * ResponseUser — 与 AskUser 对称的人机边界工具。
 * AskUser 向用户索取输入（暂停等待），ResponseUser 向用户交付最终结果（流式输出 + 终止本轮）。
 * message 经 text_chunk 事件流出，成为 assistant 消息内容。
 */
@tool(ToolIds.RESPONSE_USER)
export default class ResponseUserTool extends Tool<ResponseUserOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, ResponseUserOutput, void> {
    ctx.signal.throwIfAborted();

    const { message } = ctx.input as unknown as ResponseUserInput;

    yield { type: 'text_chunk', content: message };

    this.logger.info(`ResponseUser delivered for run ${ctx.runId}`);

    return { delivered: true };
  }
}
