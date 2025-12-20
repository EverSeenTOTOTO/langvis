import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ToolService } from '../service/ToolService';
import { v4 as uuidv4 } from 'uuid';

interface TTSRequest {
  text: string;
  reqId?: string;
  voiceType?: string;
  emotion?: string;
  speedRatio?: number;
}

@singleton()
@controller('/api/tts')
export class TTSController {
  constructor(@inject(ToolService) private toolService: ToolService) {}

  @api('/generate', { method: 'post' })
  async generateTTS(req: Request, res: Response) {
    try {
      const { text, reqId, voiceType, emotion, speedRatio }: TTSRequest =
        req.body;

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({
          error: 'Text is required and must be a non-empty string',
        });
      }

      const requestId = reqId || uuidv4();

      const result = await this.toolService.callTool('TextToSpeech Tool', {
        text,
        reqId: requestId,
        voiceType,
        emotion,
        speedRatio,
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
