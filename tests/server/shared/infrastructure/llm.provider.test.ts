import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { ProviderDefinition } from '@/shared/types/provider';

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('audio-bytes')),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('path', async importOriginal => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: actual.join,
    basename: actual.basename,
  };
});

function mockProviderService(
  provider: Partial<ProviderDefinition> = {},
  modelEndpoint?: string,
): ProviderService {
  const fullProvider: ProviderDefinition = {
    id: '302',
    name: '302AI',
    baseUrl: 'https://api.302.ai/v1',
    apiKey: 'test-key',
    models: [
      {
        id: '302:whisper-v3-turbo',
        name: 'Whisper V3 Turbo',
        type: 'stt',
        endpoint: modelEndpoint ?? '/audio/transcriptions',
      },
    ],
    ...provider,
  } as ProviderDefinition;

  return {
    getProvider: vi.fn().mockReturnValue(fullProvider),
    getModel: vi.fn().mockReturnValue(fullProvider.models[0]),
    getDefaultModel: vi.fn().mockReturnValue(fullProvider.models[0]),
  } as unknown as ProviderService;
}

const sampleApiResponse = {
  task: 'transcribe',
  language: 'zh',
  text: '你好世界',
  request_id: 'req-123',
};

describe('LlmProvider.stt', () => {
  let llmService: LlmProvider;
  let providerService: ProviderService;

  beforeEach(() => {
    vi.restoreAllMocks();
    providerService = mockProviderService();
    llmService = new LlmProvider(providerService);
  });

  it('should send multipart/form-data with correct fields', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sampleApiResponse),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await llmService.stt(
      undefined,
      {
        filePath: 'stt/test.mp3',
        mimeType: 'audio/mp3',
        language: 'zh',
        temperature: 0,
        diarize: true,
      },
      new AbortController().signal,
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.302.ai/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
    });
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('should return transcribed text from API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(sampleApiResponse),
      }),
    );

    const result = await llmService.stt(
      undefined,
      {
        filePath: 'stt/test.mp3',
        mimeType: 'audio/mp3',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      task: 'transcribe',
      language: 'zh',
      text: '你好世界',
      requestId: 'req-123',
    });
  });

  it('should throw on non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }),
    );

    await expect(
      llmService.stt(
        undefined,
        {
          filePath: 'stt/test.mp3',
          mimeType: 'audio/mp3',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('STT API failed: 429 - rate limited');
  });

  it('should throw when API returns an error object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            error: { message: 'invalid file format' },
          }),
      }),
    );

    await expect(
      llmService.stt(
        undefined,
        {
          filePath: 'stt/test.mp3',
          mimeType: 'audio/mp3',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('STT API error: invalid file format');
  });

  it('should throw when provider is not found', async () => {
    const badProviderService = {
      getProvider: vi.fn().mockReturnValue(undefined),
      getModel: vi.fn().mockReturnValue(undefined),
      getDefaultModel: vi
        .fn()
        .mockReturnValue({ id: '302:whisper-v3-turbo', type: 'stt' }),
    } as unknown as ProviderService;

    const service = new LlmProvider(badProviderService);

    await expect(
      service.stt(
        undefined,
        {
          filePath: 'stt/test.mp3',
          mimeType: 'audio/mp3',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider not found');
  });

  it('should use model endpoint override when defined', async () => {
    providerService = mockProviderService({}, '/custom/stt');
    llmService = new LlmProvider(providerService);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sampleApiResponse),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await llmService.stt(
      undefined,
      {
        filePath: 'stt/test.mp3',
        mimeType: 'audio/mp3',
      },
      new AbortController().signal,
    );

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.302.ai/v1/custom/stt');
  });
});

describe('LlmProvider.embed', () => {
  let llmService: LlmProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    const provider = {
      id: '302',
      name: '302AI',
      baseUrl: 'https://api.302.ai/v1',
      apiKey: 'test-key',
      models: [{ id: '302:emb', type: 'embedding' }],
    };
    const providerService = {
      getProvider: vi.fn().mockReturnValue(provider),
      // undefined → endpoint defaults to '/embeddings'
      getModel: vi.fn().mockReturnValue(undefined),
      getDefaultModel: vi.fn().mockReturnValue(provider.models[0]),
    } as unknown as ProviderService;
    llmService = new LlmProvider(providerService);
  });

  it('batches by EMBED_BATCH_SIZE (32) and concatenates results in input order', async () => {
    const texts = Array.from({ length: 75 }, (_, i) => String(i));
    const fetchSpy = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body) as {
        texts: string[];
      };
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            embeddings: body.texts.map(t => [Number(t)]),
          }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await llmService.embed(
      '302:emb',
      texts,
      new AbortController().signal,
    );

    // 75 texts → 32 + 32 + 11
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const batchSizes = fetchSpy.mock.calls.map(
      ([, init]) =>
        (JSON.parse((init as { body: string }).body).texts as string[]).length,
    );
    expect(batchSizes).toEqual([32, 32, 11]);

    expect(result).toHaveLength(75);
    expect(result.map(r => r.embedding[0])).toEqual(
      Array.from({ length: 75 }, (_, i) => i),
    );
  });

  it('sends a single batch when texts ≤ 32', async () => {
    const fetchSpy = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body) as {
        texts: string[];
      };
      return {
        ok: true,
        json: () => Promise.resolve({ embeddings: body.texts.map(() => [1]) }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await llmService.embed(
      '302:emb',
      ['a', 'b', 'c'],
      new AbortController().signal,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on a failing batch — no partial success leaks to the caller', async () => {
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      if (call === 2) {
        return { ok: false, status: 500, text: () => Promise.resolve('boom') };
      }
      return { ok: true, json: () => Promise.resolve({ embeddings: [[1]] }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      llmService.embed(
        '302:emb',
        Array.from({ length: 40 }, (_, i) => String(i)),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Embedding API failed: 500 - boom');
  });
});
