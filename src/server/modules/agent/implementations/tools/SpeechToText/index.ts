import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';

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
export default class SpeechToTextTool extends Tool<SpeechToTextOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    toolCall: ToolCall,
  ): AsyncGenerator<never, SpeechToTextOutput, void> {
    toolCall.signal.throwIfAborted();

    const params = toolCall.input as unknown as SpeechToTextInput;

    this.logger.info(
      `Processing STT request: ${params.filePath}, language: ${params.language || 'auto'}`,
    );

    const result = await toolCall.llm.stt(
      params.modelId,
      params,
      toolCall.signal,
    );

    this.logger.info(
      `STT completed: language=${result.language}, text_length=${result.text.length}`,
    );

    return result;
  }
}
