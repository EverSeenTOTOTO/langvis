import TextToSpeechTool from '@/server/core/tool/TextToSpeech';
import type { LlmService } from '@/server/service/LlmService';
import logger from '@/server/utils/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

async function getResult<T>(gen: AsyncGenerator<unknown, T, void>): Promise<T> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

describe('TextToSpeechTool', () => {
  let tool: TextToSpeechTool;
  let mockLlmService: LlmService;

  beforeEach(() => {
    mockLlmService = {
      tts: vi.fn(),
    } as unknown as LlmService;

    tool = new TextToSpeechTool(mockLlmService);
    (tool as any).logger = logger;

    vi.clearAllMocks();
  });

  describe('call', () => {
    it('should successfully generate TTS', async () => {
      vi.mocked(mockLlmService.tts).mockResolvedValue({
        voice: 'test-voice',
        filePath: 'tts/test-123.mp3',
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            modelId: 'doubao:tts_hd',
            text: 'Hello world',
            reqId: 'test-123',
            voice: 'test-voice',
          },
          ctx,
        ),
      );

      expect(result).toEqual({
        voice: 'test-voice',
        filePath: 'tts/test-123.mp3',
      });

      expect(mockLlmService.tts).toHaveBeenCalledWith(
        'doubao:tts_hd',
        expect.objectContaining({
          text: 'Hello world',
          reqId: 'test-123',
          voice: 'test-voice',
        }),
        ctx.signal,
      );
    });

    it('should handle API errors from LlmService', async () => {
      vi.mocked(mockLlmService.tts).mockRejectedValue(
        new Error('TTS API error: API Error'),
      );

      const ctx = createMockContext();
      await expect(
        getResult(
          tool.call(
            {
              modelId: 'doubao:tts_hd',
              voice: 'test-voice',
              text: 'test text',
              reqId: 'test-id',
            },
            ctx,
          ),
        ),
      ).rejects.toThrow('TTS API error: API Error');
    });

    it('should handle HTTP errors from LlmService', async () => {
      vi.mocked(mockLlmService.tts).mockRejectedValue(
        new Error('TTS API failed: 500 - Internal Server Error'),
      );

      const ctx = createMockContext();
      await expect(
        getResult(
          tool.call(
            {
              modelId: 'doubao:tts_hd',
              voice: 'test-voice',
              text: 'test text',
              reqId: 'test-id',
            },
            ctx,
          ),
        ),
      ).rejects.toThrow('TTS API failed: 500');
    });

    it('should pass signal to LlmService', async () => {
      vi.mocked(mockLlmService.tts).mockResolvedValue({
        voice: 'test-voice',
        filePath: 'tts/test-id.mp3',
      });

      const ctx = createMockContext();
      await getResult(
        tool.call(
          {
            modelId: 'doubao:tts_hd',
            voice: 'test-voice',
            text: 'test text',
            reqId: 'test-id',
          },
          ctx,
        ),
      );

      expect(mockLlmService.tts).toHaveBeenCalledWith(
        'doubao:tts_hd',
        expect.any(Object),
        ctx.signal,
      );
    });
  });
});
