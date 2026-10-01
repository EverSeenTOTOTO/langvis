import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { LlmPort } from '@/server/infrastructure/llm/llm.port';
import { LLM_PORT } from '@/server/infrastructure/llm/llm.tokens';
import type {
  SpeechToTextRequestDto,
  SpeechToTextResponse,
} from '@/shared/dto/controller';

@Controller('stt')
export class SttController {
  constructor(@Inject(LLM_PORT) private llmService: LlmPort) {}

  @Post('transcribe')
  async transcribe(@Body() dto: SpeechToTextRequestDto) {
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

    return {
      task: result.task,
      language: result.language,
      text: result.text,
      requestId: result.requestId,
    } satisfies SpeechToTextResponse;
  }
}
