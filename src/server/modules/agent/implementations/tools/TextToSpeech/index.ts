import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';

export interface TextToSpeechInput {
  modelId?: string;
  text: string;
  reqId: string;
  voice: string;
  emotion?: string;
  speedRatio?: number;
}

export interface TextToSpeechOutput {
  voice: string;
  filePath: string;
}

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
