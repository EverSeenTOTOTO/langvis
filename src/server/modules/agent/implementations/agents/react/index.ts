import { agent } from '@/server/decorator/core';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { AgentConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import { isEmpty } from 'lodash-es';
import { inject } from 'tsyringe';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { Prompt } from '@/server/modules/agent/domain/model/prompt';
import { createPrompt } from './prompt';

type ReActAction = {
  thought?: string;
  action: {
    tool: string;
    input: Record<string, unknown>;
  };
};

type ReActObservation = {
  observation: string;
};

type ReActStep =
  | ReActAction
  | ReActObservation
  | { thought?: string; final_answer: string };

interface ReActAgentConfig {
  model?: {
    modelId?: string;
    temperature?: number;
  };
}

@agent(AgentIds.REACT)
export default class ReActAgent extends Agent {
  readonly id!: string;
  readonly config!: AgentConfig;
  protected readonly logger!: Logger;
  readonly tools!: Tool[];

  readonly maxIterations: number = Number.MAX_SAFE_INTEGER;

  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {
    super();
  }

  get systemPrompt(): Prompt {
    let prompt = createPrompt(this, super.systemPrompt);

    const builtinIds = new Set((this.tools ?? []).map(t => t.id));
    const otherToolIds = this.toolService
      .getCachedToolIds()
      .filter(id => !builtinIds.has(id));
    const skillIds = this.skillService.getCachedSkillIds();

    if (otherToolIds.length > 0 || skillIds.length > 0) {
      prompt = prompt.insertAfter(
        'Skills',
        'Other Tools and Skills',
        [...otherToolIds, ...skillIds].join(', '),
      );
    }

    return prompt;
  }

  async *call(run: AgentRun): AsyncGenerator<RunEvent, void, void> {
    const cfg = run.config.runtimeConfig as ReActAgentConfig;
    const messages = await run.buildContext();
    const iterMessages = this.buildIterMessages(messages);

    for (let i = 0; i < this.maxIterations; i++) {
      run.signal.throwIfAborted();

      const content = await run.llm.chatContent(
        {
          messages: iterMessages,
          temperature: cfg.model?.temperature,
          stop: ['Observation:', 'Observation：'],
        },
        run.signal,
        this.logger,
      );

      if (!content) {
        yield run.fail('No response from model');
        return;
      }

      iterMessages.push({
        role: Role.ASSIST,
        content,
      });

      let parsed: Partial<ReActStep> = {};
      try {
        parsed = this.parseResponse(content);

        if (isEmpty(parsed)) {
          throw new Error('Parsed response is empty');
        }
      } catch (error) {
        const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;

        iterMessages.push({
          role: Role.USER,
          content: `Observation: ${observation}`,
        });

        continue;
      }

      this.logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        if (parsed.thought) {
          yield run.emitThought(parsed.thought);
        }
        yield run.emitTextChunk(parsed.final_answer!);
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;

        if (parsed.thought) {
          yield run.emitThought(parsed.thought);
        }

        const observation = yield* run.executeTool(tool, input);

        iterMessages.push({
          role: Role.USER,
          content: `Observation: ${observation}\n`,
        });

        continue;
      }

      const observation = `Unable to parse response: ${content}. Retrying (${i}/${this.maxIterations})...\n`;
      iterMessages.push({
        role: Role.USER,
        content: `Observation: ${observation}`,
      });
    }

    yield run.fail('Max iterations reached');
  }

  private buildIterMessages(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return messages.map(msg => {
      if (msg.role !== 'assistant') {
        return { role: msg.role as 'user' | 'system', content: msg.content };
      }

      return {
        role: 'assistant' as const,
        content: JSON.stringify({ final_answer: msg.content }),
      };
    });
  }

  private parseResponse(content: string): ReActStep {
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '');

    const parsed = JSON.parse(cleanedContent);

    if (parsed.action) {
      if (
        typeof parsed.action === 'object' &&
        parsed.action !== null &&
        typeof parsed.action.tool === 'string' &&
        parsed.action.tool.length > 0 &&
        parsed.action.input
      ) {
        return {
          thought: parsed.thought ? String(parsed.thought) : undefined,
          action: parsed.action,
        };
      }

      throw new Error('Invalid action format: missing or invalid tool/input');
    }

    if (parsed.final_answer) {
      return {
        thought: parsed.thought ? String(parsed.thought) : undefined,
        final_answer: String(parsed.final_answer),
      };
    }

    throw new Error(
      'Unrecognized JSON structure: missing `action` or `final_answer`',
    );
  }
}
