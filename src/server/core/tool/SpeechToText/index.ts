import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { LlmService } from '@/server/service/LlmService';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

export interface SpeechToTextInput {
  modelId?: string;
  filePath: string;
  mimeType: string;
  language?: string;
  temperature?: number;
  diarize?: boolean;
}

export interface SpeechToTextOutput {
  task: string;
  language: string;
  text: string;
  requestId: string;
}

@tool(ToolIds.SPEECH_TO_TEXT)
export default class SpeechToTextTool extends Tool<
  SpeechToTextInput,
  SpeechToTextOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(LlmService) private readonly llmService: LlmService) {
    super();
  }

  async *call(
    @input() params: SpeechToTextInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, SpeechToTextOutput, void> {
    ctx.signal.throwIfAborted();

    this.logger.info(
      `Processing STT request: ${params.filePath}, language: ${params.language || 'auto'}`,
    );

    const result = await this.llmService.stt(
      params.modelId,
      params,
      ctx.signal,
    );

    this.logger.info(
      `STT completed: language=${result.language}, text_length=${result.text.length}`,
    );

    return result;
  }
}
