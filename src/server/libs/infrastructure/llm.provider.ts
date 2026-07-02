import * as fs from 'fs/promises';
import * as nodePath from 'path';
import OpenAI, { type APIError } from 'openai';
import type {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { inject, singleton } from 'tsyringe';
import logger from '@/server/utils/logger';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { stripThinking } from '@/server/libs/llm-text';
import type { ModelDefinition, ModelType } from '@/shared/types/provider';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
  SpeechToTextInput,
  SpeechToTextOutput,
} from '@/server/libs/ports/llm/llm.types';
import { TraceContext } from '@/server/middleware/trace-context';
import { Role, type LlmMessage, type Message } from '@/shared/types/entities';

function toMultimodalContent(
  content: string,
  attachments?: Message['attachments'],
):
  | string
  | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }> {
  if (!attachments || attachments.length === 0) {
    return content;
  }

  const parts: Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }> = [];

  if (content.trim()) {
    parts.push({ type: 'text', text: content });
  }

  for (const att of attachments) {
    if (att.mimeType.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.url },
      });
    }
  }

  return parts.length > 0 ? parts : content;
}

function toOpenAIMessages(
  messages: LlmMessage[],
): ChatCompletionMessageParam[] {
  return messages.map(msg => {
    if (msg.role === 'user' && msg.attachments?.length) {
      return {
        role: 'user' as const,
        content: toMultimodalContent(msg.content, msg.attachments),
      } as ChatCompletionMessageParam;
    }

    return {
      role: msg.role,
      content: msg.content,
    } as ChatCompletionMessageParam;
  });
}

@singleton()
export class LlmProvider implements LlmPort {
  private clientCache = new Map<string, OpenAI>();

  constructor(
    @inject(ProviderService) private readonly providerService: ProviderService,
  ) {}

  private getOrCreateClient(providerId: string): OpenAI {
    const cached = this.clientCache.get(providerId);
    if (cached) return cached;

    const provider = this.providerService.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const client = new OpenAI({
      baseURL: provider.baseUrl,
      apiKey: provider.apiKey,
    });

    this.clientCache.set(providerId, client);
    return client;
  }

  private resolveProviderId(modelId: string): string {
    const idx = modelId.indexOf(':');
    return idx > 0 ? modelId.slice(0, idx) : modelId;
  }

  private resolveModelCode(modelId: string): string {
    const idx = modelId.indexOf(':');
    return idx > 0 ? modelId.slice(idx + 1) : modelId;
  }

  private resolveModel(
    modelId: string | undefined,
    type: 'chat' | 'embedding' | 'tts' | 'stt',
  ): string {
    if (modelId) return modelId;
    const model = this.providerService.getDefaultModel(type);
    if (!model) throw new Error(`No ${type} model available`);
    return model.id;
  }

  /** 某 type 的默认模型（委托 registry）；供 Summarizer 自取 compact 模型。 */
  getDefaultModel(type: ModelType): ModelDefinition | undefined {
    return this.providerService.getDefaultModel(type);
  }

  async *chat(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
  ): AsyncGenerator<string, string, void> {
    const resolved = this.resolveModel(modelId, 'chat');
    const providerId = this.resolveProviderId(resolved);
    const modelCode = this.resolveModelCode(resolved);
    const client = this.getOrCreateClient(providerId);

    const modelDef = this.providerService.getModel(resolved);
    const defaults = modelDef?.defaults;
    const defaultParams = {
      temperature: defaults?.temperature,
      top_p: defaults?.topP,
      ...(defaults?.extraBody ?? {}),
    };

    const rawMessages = data.messages ?? [];
    const messages = toOpenAIMessages(rawMessages as LlmMessage[]);

    logger.debug('LLM call request', {
      traceId: TraceContext.getOrFail().traceId!,
      model: resolved,
      temperature: data.temperature ?? defaultParams.temperature,
      stop: data.stop,
      messages: messages.filter(msg => msg.role !== Role.SYSTEM),
    });

    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: modelCode,
          ...defaultParams,
          ...data,
          messages,
          stream: true as const,
        },
        { signal },
      );
    } catch (err) {
      const apiError = err as APIError;
      logger.error('LLM call failed', {
        model: resolved,
        provider: providerId,
        status: apiError?.status ?? 'unknown',
        error: apiError?.error ?? apiError?.message ?? String(err),
      });
      throw err;
    }

    let content = '';

    for await (const chunk of response) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content;
      const finishReason = choice?.finish_reason;

      if (delta) {
        content += delta;
        yield delta;
      }

      if (finishReason) {
        if (finishReason === 'content_filter') {
          throw new Error('Content filter triggered - response incomplete.');
        }
        if (finishReason === 'length') {
          logger.warn('LLM stream truncated: max_tokens limit reached');
        }
        break;
      }
    }

    return content;
  }

  async chatContent(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
  ): Promise<string> {
    const resolved = this.resolveModel(modelId, 'chat');
    const providerId = this.resolveProviderId(resolved);
    const modelCode = this.resolveModelCode(resolved);
    const client = this.getOrCreateClient(providerId);

    const modelDef = this.providerService.getModel(resolved);
    const defaults = modelDef?.defaults;
    const defaultParams = {
      temperature: defaults?.temperature,
      top_p: defaults?.topP,
      ...(defaults?.extraBody ?? {}),
    };

    const rawMessages = data.messages ?? [];
    const messages = toOpenAIMessages(rawMessages as LlmMessage[]);

    logger.debug('LLM call request', {
      traceId: TraceContext.getOrFail().traceId!,
      model: resolved,
      temperature: data.temperature ?? defaultParams.temperature,
      stop: data.stop,
      messages: messages.filter(msg => msg.role !== Role.SYSTEM),
    });

    try {
      const response = await client.chat.completions.create(
        {
          model: modelCode,
          ...defaultParams,
          ...data,
          messages,
          stream: false,
        },
        { signal },
      );

      const content = response.choices[0]?.message?.content ?? '';
      const finishReason = response.choices[0]?.finish_reason;

      if (finishReason === 'content_filter') {
        throw new Error('Content filter triggered - response incomplete.');
      }
      if (finishReason === 'length') {
        logger.warn('LLM response truncated: max_tokens limit reached');
      }

      return stripThinking(content);
    } catch (err) {
      const apiError = err as APIError;
      logger.error('LLM call failed', {
        model: resolved,
        provider: providerId,
        status: apiError?.status ?? 'unknown',
        error: apiError?.error ?? apiError?.message ?? String(err),
      });
      throw err;
    }
  }

  async embed(
    modelId: string | undefined,
    texts: string[],
    signal: AbortSignal,
  ): Promise<{ embedding: number[] }[]> {
    const resolved = this.resolveModel(modelId, 'embedding');
    const providerId = this.resolveProviderId(resolved);
    const modelCode = this.resolveModelCode(resolved);
    const provider = this.providerService.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const model = this.providerService.getModel(resolved);
    const endpoint = model?.endpoint ?? '/embeddings';
    const url = `${provider.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelCode, texts }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API failed: ${response.status} - ${text}`);
    }

    const result = (await response.json()) as { embeddings: number[][] };
    return result.embeddings.map(emb => ({ embedding: emb }));
  }

  async tts(
    modelId: string | undefined,
    params: TextToSpeechInput,
    signal: AbortSignal,
  ): Promise<TextToSpeechOutput> {
    const resolved = this.resolveModel(modelId, 'tts');
    const providerId = this.resolveProviderId(resolved);
    const provider = this.providerService.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const model = this.providerService.getModel(resolved);
    const endpoint = model?.endpoint ?? '/tts';
    const url = `${provider.baseUrl.replace(/\/v1$/, '')}${endpoint}`;

    const payload = {
      audio: {
        voice_type: params.voice,
        emotion: params.emotion || 'hate',
        encoding: 'mp3',
        speed_ratio: params.speedRatio || 1.2,
      },
      request: {
        reqid: params.reqId,
        text: params.text,
        operation: 'query',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TTS API failed: ${response.status} - ${text}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `TTS API error: ${data.error.message_cn || data.error.message}`,
      );
    }
    if (data.code !== 3000) {
      throw new Error(`TTS API failed: ${data.message}`);
    }
    if (!data.data) {
      throw new Error('No audio data received from TTS API');
    }

    const ttsDir = nodePath.join(process.cwd(), 'upload', 'tts');
    await fs.mkdir(ttsDir, { recursive: true });

    const audioBuffer = Buffer.from(data.data, 'base64');
    const filename = `${params.reqId}.mp3`;
    const filePath = nodePath.join(ttsDir, filename);
    await fs.writeFile(filePath, audioBuffer);

    return { voice: params.voice, filePath: `tts/${filename}` };
  }

  async stt(
    modelId: string | undefined,
    params: SpeechToTextInput,
    signal: AbortSignal,
  ): Promise<SpeechToTextOutput> {
    const resolved = this.resolveModel(modelId, 'stt');
    const providerId = this.resolveProviderId(resolved);
    const modelCode = this.resolveModelCode(resolved);
    const provider = this.providerService.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const model = this.providerService.getModel(resolved);
    const endpoint = model?.endpoint ?? '/audio/transcriptions';
    const url = `${provider.baseUrl}${endpoint}`;

    const fileBuffer = await fs.readFile(
      nodePath.join(process.cwd(), 'upload', params.filePath),
    );
    const filename = nodePath.basename(params.filePath);
    const file = new File([new Uint8Array(fileBuffer)], filename, {
      type: params.mimeType,
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', modelCode);
    formData.append('language', params.language || '');
    formData.append('temperature', String(params.temperature ?? 0));
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('diarize', String(params.diarize ?? true));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: formData,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`STT API failed: ${response.status} - ${text}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `STT API error: ${data.error.message || JSON.stringify(data.error)}`,
      );
    }

    return {
      task: data.task,
      language: data.language,
      text: data.text,
      requestId: data.request_id,
    };
  }
}
