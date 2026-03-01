import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import { runTool } from '@/server/utils';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
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
    yield ctx.agentStartEvent();

    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);

    const messages = await memory.summarize();
    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    this.logger.debug('GF agent messages: ', conversationMessages);

    const llmGenerator = llmCallTool.call(
      {
        model: options?.model?.code,
        temperature: options?.model?.temperature,
        messages: conversationMessages,
      },
      ctx,
    );

    for await (const toolEvent of llmGenerator) {
      if (toolEvent.type === 'progress' && typeof toolEvent.data === 'string') {
        yield ctx.agentStreamEvent(toolEvent.data);
      } else {
        yield ctx.adaptToolEvent(toolEvent);
      }
    }

    const tts = container.resolve<TextToSpeechTool>(ToolIds.TEXT_TO_SPEECH);
    const ttsArgs = {
      text: ctx.message.content,
      reqId: generateId('req'),
      voice: options?.tts?.voice || '',
      emotion: options?.tts?.emotion || '',
      speedRatio: options?.tts?.speedRatio,
    };

    yield ctx.agentToolCallEvent(ToolIds.TEXT_TO_SPEECH, ttsArgs);

    const ttsResult = yield* runTool(tts.call(ttsArgs, ctx), e =>
      ctx.adaptToolEvent(e),
    );

    yield ctx.agentToolResultEvent(ToolIds.TEXT_TO_SPEECH, ttsResult);
    yield ctx.agentFinalEvent();
  }
}
