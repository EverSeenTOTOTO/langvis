import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { EnrichedEvent } from '@/shared/types/events';

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
    toolCall: ToolCall,
  ): AsyncGenerator<EnrichedEvent, TextToSpeechOutput, void> {
    toolCall.signal.throwIfAborted();

    const params = toolCall.input as unknown as TextToSpeechInput;

    this.logger.info(
      `Processing TTS request: ${params.reqId}, voice: ${params.voice}, text_length: ${params.text.length}`,
    );

    const result = await toolCall.llm.tts(
      params.modelId,
      params,
      toolCall.signal,
    );

    this.logger.info(
      `TTS completed successfully: ${params.reqId}, file: ${result.filePath}`,
    );

    return result;
  }
}
