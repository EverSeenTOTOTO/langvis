import TextToSpeechTool from '@/server/core/tool/TextToSpeech';
import { ExecutionContext } from '@/server/core/context';
import { runTool } from '@/server/utils';
import logger from '@/server/utils/logger';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('fs', () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
  },
}));

global.fetch = vi.fn();

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
}

describe('TextToSpeechTool', () => {
  let tool: TextToSpeechTool;
  const originalEnv = process.env;

  beforeEach(() => {
    tool = new TextToSpeechTool();
    // @ts-expect-error readonly
    tool.config = {
      name: { en: 'TextToSpeech Tool' },
      description: { en: 'Converts text to speech' },
    };
    (tool as any).logger = logger;

    process.env = {
      ...originalEnv,
      OPENAI_API_BASE: 'https://api.example.com',
      OPENAI_API_KEY: 'test-key',
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('call', () => {
    it('should throw error when environment variables are missing', async () => {
      delete process.env.OPENAI_API_BASE;
      delete process.env.OPENAI_API_KEY;

      const ctx = createMockContext();
      await expect(
        runTool(
          tool.call(
            {
              voice: 'test-voice',
              text: 'test text',
              reqId: 'test-id',
            },
            ctx,
          ),
        ),
      ).rejects.toThrow(
        'OPENAI_API_BASE and OPENAI_API_KEY must be configured',
      );
    });

    it('should successfully generate TTS', async () => {
      const mockAudioData = Buffer.from('mock audio data').toString('base64');

      (fs.access as any).mockRejectedValue(new Error('Directory not found'));
      (fs.mkdir as any).mockResolvedValue(undefined);
      (fs.writeFile as any).mockResolvedValue(undefined);
      (fs.stat as any).mockResolvedValue({ size: 15 });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 3000,
          data: mockAudioData,
        }),
      });

      const ctx = createMockContext();
      const result = await runTool(
        tool.call(
          {
            text: 'Hello world',
            reqId: 'test-123',
            voice: 'test-voice',
          },
          ctx,
        ),
      );

      expect(result).toEqual({
        voice: expect.any(String),
        filePath: 'tts/test-123.mp3',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/doubao/tts_hd',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-key',
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should handle API errors', async () => {
      (fs.access as any).mockRejectedValue(new Error('Directory not found'));
      (fs.mkdir as any).mockResolvedValue(undefined);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          error: {
            message: 'API Error',
          },
        }),
      });

      const ctx = createMockContext();
      await expect(
        runTool(
          tool.call(
            {
              voice: 'test-voice',
              text: 'test text',
              reqId: 'test-id',
            },
            ctx,
          ),
        ),
      ).rejects.toThrow('TTS API error: API Error');
    });

    it('should handle HTTP errors', async () => {
      (fs.access as any).mockRejectedValue(new Error('Directory not found'));
      (fs.mkdir as any).mockResolvedValue(undefined);

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const ctx = createMockContext();
      await expect(
        runTool(
          tool.call(
            {
              voice: 'test-voice',
              text: 'test text',
              reqId: 'test-id',
            },
            ctx,
          ),
        ),
      ).rejects.toThrow('TTS API request failed with status 500');
    });
  });
});
