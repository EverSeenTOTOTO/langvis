import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import { runTool } from '@/server/utils';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { container } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { Agent } from '..';
import { Memory } from '../../memory';
import type LlmCallTool from '../../tool/LlmCall';
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

  async *call(
    memory: Memory,
    @config() options?: GirlFriendConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'start', agentId: this.id };

    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);
    const tts = container.resolve<TextToSpeechTool>(ToolIds.TEXT_TO_SPEECH);

    const messages = await memory.summarize();
    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    this.logger.debug('GF agent messages: ', conversationMessages);

    let content = '';

    const llmGenerator = llmCallTool.call(
      {
        model: options?.model?.code,
        temperature: options?.model?.temperature,
        messages: conversationMessages,
      },
      signal,
    );

    for await (const event of llmGenerator) {
      if (event.type === 'delta') {
        content += event.data;
        yield { type: 'delta', content: event.data };
      }
    }

    const ttsGenerator = tts.call(
      {
        text: content,
        reqId: uuid(),
        voice: options?.tts?.voice || '',
        emotion: options?.tts?.emotion || '',
        speedRatio: options?.tts?.speedRatio,
      },
      signal,
    );

    yield { type: 'meta', meta: await runTool(ttsGenerator) };
    yield { type: 'end', agentId: this.id };
  }
}
