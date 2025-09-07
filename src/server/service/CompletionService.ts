import OpenAI from 'openai';
import { singleton } from 'tsyringe';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { logger } from '../middleware/logger';

@singleton()
export class CompletionService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      logger,
    });
  }

  chatCompletion(body: Partial<ChatCompletionCreateParamsNonStreaming>) {
    return this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL!,
      messages: [],
      ...body,
      stream: false,
    });
  }

  streamChatCompletion(body: Partial<ChatCompletionCreateParamsStreaming>) {
    return this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL!,
      messages: [],
      ...body,
      stream: true,
    });
  }
}
