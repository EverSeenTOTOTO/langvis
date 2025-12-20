import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSController } from '@/server/controller/TTSController';
import type { Request, Response } from 'express';

const mockToolService = {
  callTool: vi.fn(),
  getAllToolInfo: vi.fn(),
};

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mocked-uuid'),
}));

describe('TTSController', () => {
  let controller: TTSController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    controller = new TTSController(mockToolService as any);

    mockReq = {
      body: {},
      params: {},
    };

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe('generateTTS', () => {
    it('should generate TTS successfully', async () => {
      mockReq.body = { text: 'Hello world' };

      const mockResult = {
        filename: 'test.mp3',
        voiceType: 'zh_female_roumeinvyou_emo_v2_mars_bigtts',
        filePath: 'tts/test.mp3',
      };

      mockToolService.callTool.mockResolvedValue(mockResult);

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockToolService.callTool).toHaveBeenCalledWith(
        'TextToSpeech Tool',
        {
          text: 'Hello world',
          reqId: 'mocked-uuid',
          voiceType: undefined,
          emotion: undefined,
          speedRatio: undefined,
        },
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it('should use provided reqId', async () => {
      mockReq.body = { text: 'Hello world', reqId: 'custom-id' };

      const mockResult = {
        filename: 'custom-id.mp3',
        voiceType: 'zh_female_roumeinvyou_emo_v2_mars_bigtts',
        filePath: 'tts/custom-id.mp3',
      };

      mockToolService.callTool.mockResolvedValue(mockResult);

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockToolService.callTool).toHaveBeenCalledWith(
        'TextToSpeech Tool',
        {
          text: 'Hello world',
          reqId: 'custom-id',
          voiceType: undefined,
          emotion: undefined,
          speedRatio: undefined,
        },
      );
    });

    it('should pass options to TTS tool', async () => {
      mockReq.body = {
        text: 'Hello world',
        voiceType: 'custom-voice',
        speedRatio: 1.5,
        emotion: 'happy',
      };

      mockToolService.callTool.mockResolvedValue({});

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockToolService.callTool).toHaveBeenCalledWith(
        'TextToSpeech Tool',
        {
          text: 'Hello world',
          reqId: 'mocked-uuid',
          voiceType: 'custom-voice',
          speedRatio: 1.5,
          emotion: 'happy',
        },
      );
    });

    it('should return 400 for empty text', async () => {
      mockReq.body = { text: '' };

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Text is required and must be a non-empty string',
      });
    });

    it('should return 400 for non-string text', async () => {
      mockReq.body = { text: 123 };

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Text is required and must be a non-empty string',
      });
    });

    it('should handle service errors', async () => {
      mockReq.body = { text: 'Hello world' };
      mockToolService.callTool.mockRejectedValue(
        new Error('TTS service error'),
      );

      await controller.generateTTS(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'TTS service error',
      });
    });
  });
});
