import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { OpenAI } from '@/server/service/openai';
import { TraceContext } from '../../TraceContext';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { Role, type MessageAttachment } from '@/shared/types/entities';
import type {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

export type LlmCallInput = Partial<ChatCompletionCreateParams>;
export type LlmCallOutput = string;

type InternalMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[] | null;
};

/**
 * Convert message with attachments to OpenAI multimodal format
 */
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

/**
 * Convert internal messages to OpenAI format, handling multimodal content
 */
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

@tool(ToolIds.LLM_CALL)
export default class LlmCallTool extends Tool<LlmCallInput, LlmCallOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(InjectTokens.OPENAI) private readonly openai: OpenAI) {
    super();
  }

  async *call(
    @input() data: LlmCallInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, LlmCallOutput, void> {
    const rawMessages = data.messages ?? [];
    const messages = toOpenAIMessages(rawMessages as InternalMessage[]);
    const model = data.model || process.env.OPENAI_MODEL!;

    this.logger.debug('LLM call request', {
      traceId: TraceContext.getOrFail().traceId!,
      model,
      messageCount: messages.length,
      temperature: data.temperature,
      stop: data.stop,
      messages: messages.filter(msg => msg.role !== Role.SYSTEM),
    });

    const response = await this.openai.chat.completions.create(
      {
        model,
        ...data,
        messages,
        stream: true,
      },
      { signal: ctx.signal },
    );

    let content = '';

    for await (const chunk of response) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content;
      const finishReason = choice?.finish_reason;

      if (delta) {
        content += delta;
        yield ctx.agentToolProgressEvent(this.id, delta);
      }

      if (finishReason) {
        if (finishReason === 'content_filter') {
          const error =
            'Content filter triggered - response incomplete. ' +
            'The input or generated content may violate content policy. ' +
            'Try: (1) rephrase the input to avoid sensitive topics, ' +
            '(2) use a different model, (3) simplify or shorten the prompt.';
          this.logger.warn(`LLM stream aborted: ${error}`);
          throw new Error(error);
        }

        if (finishReason === 'length') {
          this.logger.warn(
            'LLM stream truncated: max_tokens limit reached - response may be incomplete',
          );
        }

        break;
      }
    }

    return content;
  }
}
