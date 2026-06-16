import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
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

  async *call(
    run: AgentRun,
  ): AsyncGenerator<AgentEvent | StreamChunk, void, void> {
    const cfg = run.config.runtimeConfig as GirlFriendConfig;
    const messages = await run.summarize();

    const generator = run.llm.chat(
      {
        messages,
        temperature: cfg.model?.temperature,
      },
      run.signal,
      this.logger,
    );

    let accumulatedContent = '';
    for await (const chunk of generator) {
      yield run.appendContent(chunk);
      accumulatedContent += chunk;
    }

    if (cfg.tts?.modelId) {
      const ttsArgs = {
        modelId: cfg.tts.modelId,
        text: accumulatedContent,
        reqId: run.messageId,
        voice: cfg.tts.voice || '',
        emotion: cfg.tts.emotion || '',
        speedRatio: cfg.tts.speedRatio,
      };

      yield* run.executeTool(ToolIds.TEXT_TO_SPEECH, ttsArgs);
    }
  }
}
