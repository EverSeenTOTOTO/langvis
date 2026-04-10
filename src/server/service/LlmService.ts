import OpenAI from 'openai';
import type {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { inject, singleton } from 'tsyringe';
import type { Logger } from '../utils/logger';
import { ProviderService } from './ProviderService';
import { ToolIds } from '@/shared/constants';
import { TraceContext } from '../core/TraceContext';
import type { AgentEvent } from '@/shared/types';
import { Role, type MessageAttachment } from '@/shared/types/entities';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
} from '../core/tool/TextToSpeech';

type InternalMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[] | null;
};

function toMultimodalContent(
  content: string,
  attachments?: MessageAttachment[] | null,
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
  messages: InternalMessage[],
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
export class LlmService {
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
    type: 'chat' | 'embedding' | 'tts',
  ): string {
    if (modelId) return modelId;
    const model = this.providerService.getDefaultModel(type);
    if (!model) throw new Error(`No ${type} model available`);
    return model.id;
  }

  async *chat(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncGenerator<AgentEvent, string, void> {
    const resolved = this.resolveModel(modelId, 'chat');
    const providerId = this.resolveProviderId(resolved);
    const modelCode = this.resolveModelCode(resolved);
    const client = this.getOrCreateClient(providerId);

    const rawMessages = data.messages ?? [];
    const messages = toOpenAIMessages(rawMessages as InternalMessage[]);

    logger.debug('LLM call request', {
      traceId: TraceContext.getOrFail().traceId!,
      model: resolved,
      temperature: data.temperature,
      stop: data.stop,
      messages: messages.filter(msg => msg.role !== Role.SYSTEM),
    });

    const response = await client.chat.completions.create(
      {
        model: modelCode,
        ...data,
        messages,
        stream: true,
      },
      { signal },
    );

    let content = '';

    for await (const chunk of response) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content;
      const finishReason = choice?.finish_reason;

      if (delta) {
        content += delta;
        yield {
          type: 'tool_progress',
          messageId: '',
          callId: '',
          toolName: ToolIds.LLM_CALL,
          data: delta,
          seq: 0,
          at: Date.now(),
        };
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

    const url = `${provider.baseUrl}/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelCode, input: texts }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API failed: ${response.status} - ${text}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return result.data.sort((a, b) => a.index - b.index);
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

    const fs = await import('fs/promises');
    const nodePath = await import('path');
    const ttsDir = nodePath.join(process.cwd(), 'upload', 'tts');
    await fs.mkdir(ttsDir, { recursive: true });

    const audioBuffer = Buffer.from(data.data, 'base64');
    const filename = `${params.reqId}.mp3`;
    const filePath = nodePath.join(ttsDir, filename);
    await fs.writeFile(filePath, audioBuffer);

    return { voice: params.voice, filePath: `tts/${filename}` };
  }
}
