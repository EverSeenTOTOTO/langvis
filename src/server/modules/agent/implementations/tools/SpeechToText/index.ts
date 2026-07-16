import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type {
  SpeechToTextInput,
  SpeechToTextOutput,
} from '@/server/libs/ports/llm/llm.types';

// 向后兼容：历史代码自本工具导入这两个类型，re-export 内核定义。
export type { SpeechToTextInput, SpeechToTextOutput };

@tool(ToolIds.SPEECH_TO_TEXT)
export default class SpeechToTextTool extends Tool<SpeechToTextOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<never, SpeechToTextOutput, void> {
    ctx.signal.throwIfAborted();

    const params = ctx.input as unknown as SpeechToTextInput;

    this.logger.info(
      `Processing STT request: ${params.filePath}, language: ${params.language || 'auto'}`,
    );

    const result = await ctx.llm.stt(params.modelId, params, ctx.signal);

    this.logger.info(
      `STT completed: language=${result.language}, text_length=${result.text.length}`,
    );

    return result;
  }
}
