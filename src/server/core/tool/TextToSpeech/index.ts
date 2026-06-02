import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { LlmService } from '@/server/service/LlmService';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/tool.base';

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
export default class TextToSpeechTool extends Tool<
  TextToSpeechInput,
  TextToSpeechOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(LlmService) private readonly llmService: LlmService) {
    super();
  }

  async *call(
    @input() params: TextToSpeechInput,
    ctx: { signal: AbortSignal },
  ): AsyncGenerator<
    { type: 'tool_progress'; data: unknown },
    TextToSpeechOutput,
    void
  > {
    ctx.signal.throwIfAborted();

    this.logger.info(
      `Processing TTS request: ${params.reqId}, voice: ${params.voice}, text_length: ${params.text.length}`,
    );

    const result = await this.llmService.tts(
      params.modelId,
      params,
      ctx.signal,
    );

    this.logger.info(
      `TTS completed successfully: ${params.reqId}, file: ${result.filePath}`,
    );

    return result;
  }
}
