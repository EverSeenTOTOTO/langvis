import { agent } from '@/server/decorator/config';
import Logger from '@/server/service/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Message } from '@/shared/entities/Message';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { container } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { Agent } from '..';
import type { Tool } from '../../tool';
import type TextToSpeechTool from '../../tool/TextToSpeech';

@agent(AgentIds.GIRLFRIEND_AGENT)
export default class GirlFriendAgent extends Agent {
  id!: string;
  config!: AgentConfig;

  private readonly logger = Logger.child({ source: AgentIds.GIRLFRIEND_AGENT });

  async getSystemPrompt(): Promise<string> {
    return ``;
  }

  async streamCall(
    messages: Message[],
    outputStream: WritableStream<StreamChunk>,
    config?: Record<string, any>,
  ) {
    const llmCallTool = container.resolve<Tool>(ToolIds.LLM_CALL);

    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    this.logger.debug('GF agent messages: ', conversationMessages);
    const writer = outputStream.getWriter();
    const tts = container.resolve<TextToSpeechTool>(ToolIds.TEXT_TO_SPEECH);

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
