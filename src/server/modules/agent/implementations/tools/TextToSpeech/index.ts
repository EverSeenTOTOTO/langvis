import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
} from '@/server/libs/ports/llm/llm.types';

// 向后兼容：历史代码自本工具导入这两个类型，re-export 内核定义。
export type { TextToSpeechInput, TextToSpeechOutput };

@tool(ToolIds.TEXT_TO_SPEECH)
export default class TextToSpeechTool extends Tool<TextToSpeechOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, TextToSpeechOutput, void> {
    ctx.signal.throwIfAborted();

    const input = ctx.input as unknown as TextToSpeechInput;

    // voice/reqId/modelId 由调用方决定（reqId 缺省用 runId）；仅 text 与 emotion 可选。
    const params: TextToSpeechInput = {
      text: input.text,
      reqId: input.reqId ?? ctx.runId,
      voice: input.voice ?? '',
      modelId: input.modelId,
      emotion: input.emotion,
      speedRatio: input.speedRatio,
    };

    if (!params.voice) {
      throw new Error('TTS voice unavailable: pass `voice`');
    }

    this.logger.info(
      `Processing TTS request: ${params.reqId}, voice: ${params.voice}, text_length: ${params.text.length}`,
    );

    const result = await ctx.llm.tts(params.modelId, params, ctx.signal);

    this.logger.info(
      `TTS completed successfully: ${params.reqId}, file: ${result.filePath}`,
    );

    return result;
  }
}
