import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { TextToSpeechInput } from '../TextToSpeech';
import type { ResponseUserTtsConfig } from './config';

export interface ResponseUserInput {
  message: string;
  tts?: ResponseUserTtsConfig;
}

export interface ResponseUserOutput {
  delivered: boolean;
}

// ResponseUser — 人机边界交付工具：message 经 text_chunk 流出并终止本轮。可选 tts 在交付后合成语音，失败仅告警。
@tool(ToolIds.RESPONSE_USER)
export default class ResponseUserTool extends Tool<ResponseUserOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, ResponseUserOutput, void> {
    ctx.signal.throwIfAborted();

    const { message, tts } = ctx.input as unknown as ResponseUserInput;

    yield { type: 'text_chunk', content: message };

    if (tts?.enabled) {
      yield* this.synthesizeAudio(ctx, message, tts);
    }

    this.logger.info(`ResponseUser delivered for run ${ctx.runId}`);

    return { delivered: true };
  }

  // 合成语音并流出 audio 事件。voice 缺失或合成失败时仅告警、返回—— 文本回复已交付，音频是附加产物，其失败不应让本轮报错。
  private async *synthesizeAudio(
    ctx: ToolCallContext,
    message: string,
    tts: ResponseUserTtsConfig,
  ): AsyncGenerator<RunEvent, void, void> {
    if (!tts.voice) {
      this.logger.warn(
        `ResponseUser tts enabled for run ${ctx.runId} but no voice provided — skipping audio`,
      );
      return;
    }

    this.logger.info(`Generating speech audio response for run ${ctx.runId}`);

    try {
      const params: TextToSpeechInput = {
        text: message,
        reqId: ctx.runId,
        voice: tts.voice,
        emotion: tts.emotion,
        speedRatio: tts.speedRatio,
      };
      const result = await ctx.llm.tts(undefined, params, ctx.signal);
      yield { type: 'audio', filePath: result.filePath, voice: result.voice };
    } catch (err) {
      this.logger.warn(
        `ResponseUser TTS failed for run ${ctx.runId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
