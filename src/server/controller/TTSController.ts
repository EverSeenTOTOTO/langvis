import { ToolIds } from '@/shared/constants';
import { GenerateTTSRequestDto } from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, request, response } from '../decorator/param';
import { ToolService } from '../service/ToolService';

@controller('/api/tts')
export default class TTSController {
  constructor(@inject(ToolService) private toolService: ToolService) {}

  @api('/generate', { method: 'post' })
  async generateTTS(
    @body() dto: GenerateTTSRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    try {
      if (!req.id) {
        return res.status(500).json({
          error: 'ReqId is required.',
        });
      }

      const result = await this.toolService.callTool(ToolIds.TEXT_TO_SPEECH, {
        text: dto.text,
        reqId: req.id,
        voiceType: dto.voiceType,
        emotion: dto.emotion,
        speedRatio: dto.speedRatio,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  }
}
