import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { container } from 'tsyringe';
import { Agent } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Memory } from '../../memory';
import { Prompt } from '../../PromptBuilder';
import { Tool } from '../../tool';
import { TraceContext } from '../../TraceContext';
import type TextToSpeechTool from '../../tool/TextToSpeech';
import { createPrompt } from './prompt';

interface GirlFriendConfig {
  model?: {
    modelId?: string;
    temperature?: number;
  };
  tts?: {
    modelId?: string;
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
  readonly tools!: Tool[];
  readonly agents!: Agent[];

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: GirlFriendConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield ctx.agentStartEvent();

    const messages = await memory.summarize();

    const modelId = options?.model?.modelId;

    const accumulatedContent = yield* ctx.callLlm(
      {
        modelId,
        temperature: options?.model?.temperature,
        messages,
      },
      false,
    );

    const tts = container.resolve<TextToSpeechTool>(ToolIds.TEXT_TO_SPEECH);
    const ttsArgs = {
      modelId: options?.tts?.modelId,
      text: accumulatedContent,
      reqId: TraceContext.getOrFail().requestId,
      voice: options?.tts?.voice || '',
      emotion: options?.tts?.emotion || '',
      speedRatio: options?.tts?.speedRatio,
    };

    yield ctx.agentToolCallEvent(ToolIds.TEXT_TO_SPEECH, ttsArgs);

    const ttsResult = yield* tts.call(ttsArgs, ctx);

    yield ctx.agentToolResultEvent(ToolIds.TEXT_TO_SPEECH, ttsResult);
    yield ctx.agentFinalEvent();
  }
}
