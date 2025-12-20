import { logger } from '@/server/middleware/logger';
import { Message } from '@/shared/entities/Message';
import { StreamChunk } from '@/shared/types';
import { container, injectable } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { Agent } from '..';
import LlmCallTool from '../../tool/LlmCall';
import TextToSpeechTool from '../../tool/TextToSpeech';

@injectable()
export default class ChatAgent extends Agent {
  name!: string;
  description!: string;

  async getSystemPrompt(): Promise<string> {
    return ``;
  }

  async streamCall(
    messages: Message[],
    outputStream: WritableStream<StreamChunk>,
    config?: Record<string, any>,
  ) {
    const llmCallTool = container.resolve<LlmCallTool>('LlmCall Tool');

    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    logger.debug('Chat agent messages: ', conversationMessages);
    const writer = outputStream.getWriter();
    const tts = container.resolve<TextToSpeechTool>('TextToSpeech Tool');

    let content = '';

    const localStream = new WritableStream({
      write: async chunk => {
        await writer.write({ type: 'chunk', data: chunk });
        content += chunk;
      },
      close: async () => {
        try {
          const result = await tts.call({
            text: content,
            reqId: uuid(),
            voice: config?.tts?.voice,
            emotion: config?.tts?.emotion,
            speedRatio: config?.tts?.speedRatio,
          });
          await writer.write({ type: 'meta', data: result });
          await writer.close();
        } catch (err) {
          writer.abort(err);
        }
      },
      abort: reason => writer.abort(reason),
    });

    await llmCallTool.streamCall(
      {
        model: config?.model?.code,
        temperature: config?.model?.temperature,
        messages: conversationMessages,
      },
      localStream,
    );
  }
}
