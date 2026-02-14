import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import { runTool } from '@/server/utils';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { container } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { Agent } from '..';
import { ExecutionContext } from '../../context';
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
    ctx: ExecutionContext,
    @config() options?: GirlFriendConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
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
      ctx,
    );

    for await (const toolEvent of llmGenerator) {
      yield ctx.adaptToolEvent(toolEvent);
      if (toolEvent.type === 'progress' && typeof toolEvent.data === 'string') {
        content += toolEvent.data;
      }
    }

    await runTool(
      tts.call(
        {
          text: content,
          reqId: uuid(),
          voice: options?.tts?.voice || '',
          emotion: options?.tts?.emotion || '',
          speedRatio: options?.tts?.speedRatio,
        },
        ctx,
      ),
    );

    yield ctx.agentEvent({ type: 'final' });
  }
}
