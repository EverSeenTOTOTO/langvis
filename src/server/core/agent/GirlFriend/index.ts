import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { container } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { Agent } from '..';
import { Memory } from '../../memory';
import type { Tool } from '../../tool';
import type TextToSpeechTool from '../../tool/TextToSpeech';
import generatePrompt from './prompt';

interface GirlFriendConfig {
  model?: {
    code?: string;
    temperature?: number;
  };
  tts?: {
    voice?: string;
    emotion?: string;
    speedRatio?: number;
  };
}

@agent(AgentIds.GIRLFRIEND)
export default class GirlFriendAgent extends Agent {
  readonly id!: string;
  readonly config!: AgentConfig;
  protected readonly logger!: Logger;

  async getSystemPrompt(): Promise<string> {
    return generatePrompt();
  }

  async streamCall(
    memory: Memory,
    outputWriter: WritableStreamDefaultWriter<StreamChunk>,
    @config() options: GirlFriendConfig,
  ) {
    const llmCallTool = container.resolve<Tool>(ToolIds.LLM_CALL);

    const messages = await memory.summarize();
    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    this.logger.debug('GF agent messages: ', conversationMessages);
    const writer = outputWriter;
    const tts = container.resolve<TextToSpeechTool>(ToolIds.TEXT_TO_SPEECH);

    let content = '';

    const localStream = new WritableStream({
      write: async chunk => {
        await writer.write(chunk);
        content += chunk;
      },
      close: async () => {
        try {
          const result = await tts.call({
            text: content,
            reqId: uuid(),
            voice: options?.tts?.voice || '',
            emotion: options?.tts?.emotion || '',
            speedRatio: options?.tts?.speedRatio,
          });
          await writer.write({ meta: result });
          await writer.close();
        } catch (err) {
          writer.abort(err);
        }
      },
      abort: reason => writer.abort(reason),
    });

    const localWriter = localStream.getWriter();

    await llmCallTool.streamCall(
      {
        model: options?.model?.code,
        temperature: options?.model?.temperature,
        messages: conversationMessages,
      },
      localWriter,
    );
  }
}
