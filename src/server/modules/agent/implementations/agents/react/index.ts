import { agent } from '@/server/decorator/core';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { AgentConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import { inject } from 'tsyringe';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { Prompt } from '@/server/modules/agent/domain/model/prompt';
import { createPrompt } from './prompt';

type ReActAction = {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
};

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

  async *call(ctx: AgentRunContext): AsyncGenerator<RunEvent, void, void> {
    const cfg = ctx.config.runtimeConfig as ReActAgentConfig;
    const messages = await ctx.memory.buildContext();
    const iterMessages = this.buildIterMessages(messages);

    for (let i = 0; i < this.maxIterations; i++) {
      ctx.signal.throwIfAborted();

      const content = await ctx.llm.chatContent(
        {
          messages: iterMessages,
          temperature: cfg.model?.temperature,
          stop: ['Observation:', 'Observation：'],
        },
        ctx.signal,
        this.logger,
      );

      if (!content) {
        throw new Error('No response from model');
      }

      iterMessages.push({
        role: Role.ASSIST,
        content,
      });

      let parsed: ReActAction;
      try {
        parsed = this.parseResponse(content);
      } catch (error) {
        const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;

        iterMessages.push({
          role: Role.USER,
          content: `Observation: ${observation}`,
        });

        continue;
      }

      this.logger.info('ReAct parsed response: ', parsed);

      const { tool, input } = parsed;

      if (parsed.thought) {
        yield { type: 'thought', content: parsed.thought };
      }

      const observation = yield* ctx.executeTool(tool, input);

      // response_user 是终态工具（交付最终结果后结束本轮）。
      if (tool === ToolIds.RESPONSE_USER) {
        return;
      }

      iterMessages.push({
        role: Role.USER,
        content: `Observation: ${observation}\n`,
      });
    }

    throw new Error('Max iterations reached');
  }

  private buildIterMessages(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return messages.map(msg => {
      if (msg.role !== 'assistant') {
        return { role: msg.role as 'user' | 'system', content: msg.content };
      }

      // 历史回复重建为扁平的 response_user 调用，保持与当前输出格式一致。
      return {
        role: 'assistant' as const,
        content: JSON.stringify({
          tool: ToolIds.RESPONSE_USER,
          input: { message: msg.content },
        }),
      };
    });
  }

  private parseResponse(content: string): ReActAction {
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '');

    const parsed = JSON.parse(cleanedContent);

    if (
      typeof parsed.tool === 'string' &&
      parsed.tool.length > 0 &&
      parsed.input &&
      typeof parsed.input === 'object'
    ) {
      return {
        thought: parsed.thought ? String(parsed.thought) : undefined,
        tool: parsed.tool,
        input: parsed.input,
      };
    }

    throw new Error(
      'Invalid response: missing or invalid top-level `tool`/`input`',
    );
  }
}
