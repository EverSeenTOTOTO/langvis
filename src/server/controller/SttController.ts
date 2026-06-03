import type { Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, response } from '../decorator/param';
import { LlmService } from '@/server/modules/memory/services/llm.service';
import type {
  SpeechToTextRequestDto,
  SpeechToTextResponse,
} from '@/shared/dto/controller';

@controller('/api/stt')
export default class SttController {
  constructor(@inject(LlmService) private llmService: LlmService) {}

  @api('/transcribe', { method: 'post' })
  async transcribe(
    @body() dto: SpeechToTextRequestDto,
    @response() res: Response,
  ): Promise<void> {
    const result = await this.llmService.stt(
      undefined,
      {
        filePath: dto.filePath,
        mimeType: dto.mimeType,
        language: dto.language,
        temperature: dto.temperature,
        diarize: dto.diarize,
      },
      AbortSignal.timeout(60_000),
    );

    res.json({
      task: result.task,
      language: result.language,
      text: result.text,
      requestId: result.requestId,
    } satisfies SpeechToTextResponse);
  }
}
