import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { Prompt } from '@/server/modules/agent/domain/model/prompt';
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

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }

  async *call(ctx: AgentRunContext): AsyncGenerator<RunEvent, void, void> {
    const cfg = ctx.config.runtimeConfig as GirlFriendConfig;
    const messages = await ctx.buildContext();

    const generator = ctx.llm.chat(
      {
        messages,
        temperature: cfg.model?.temperature,
      },
      ctx.signal,
      this.logger,
    );

    let accumulatedContent = '';
    for await (const chunk of generator) {
      yield { type: 'text_chunk', content: chunk };
      accumulatedContent += chunk;
    }

    if (cfg.tts?.modelId) {
      const ttsArgs = {
        modelId: cfg.tts.modelId,
        text: accumulatedContent,
        reqId: ctx.runId,
        voice: cfg.tts.voice || '',
        emotion: cfg.tts.emotion || '',
        speedRatio: cfg.tts.speedRatio,
      };

      yield* ctx.executeTool(ToolIds.TEXT_TO_SPEECH, ttsArgs);
    }
  }
}
