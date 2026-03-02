import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import { runTool } from '@/server/utils';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { isEmpty } from 'lodash-es';
import { container } from 'tsyringe';
import { Agent } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Memory } from '../../memory';
import { Tool } from '../../tool';
import type LlmCallTool from '../../tool/LlmCall';
import generatePrompt from './prompt';

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
    code?: string;
    temperature?: number;
  };
}

@agent(AgentIds.REACT)
export default class ReActAgent extends Agent {
  readonly id!: string;
  readonly config!: AgentConfig;
  protected readonly logger!: Logger;

  readonly maxIterations = 5;

  public tools: Tool[] = [];

  async getSystemPrompt(): Promise<string> {
    return generatePrompt({
      background: '',
      tools: formatToolsToMarkdown(this.tools),
    });
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: ReActAgentConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield ctx.agentStartEvent();

    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);

    const messages = await memory.summarize();
    const iterMessages = this.buildIterMessages(messages);

    for (let i = 0; i < this.maxIterations; i++) {
      ctx.signal.throwIfAborted();

      this.logger.debug(
        'ReAct iter messages: ',
        iterMessages.filter(m => m.role !== Role.SYSTEM),
      );

      const content = yield* runTool(
        llmCallTool.call(
          {
            messages: iterMessages,
            model: options?.model?.code,
            temperature: options?.model?.temperature,
            stop: ['Observation:', 'Observation：'],
          },
          ctx,
        ),
        e => ctx.adaptToolEvent(e),
      );

      if (!content) {
        yield ctx.agentErrorEvent('No response from model');
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
        const observation = `Error parsing response: ${(error as Error).message}`;

        iterMessages.push({
          role: Role.USER,
          content: `Observation: ${observation}`,
        });
        continue;
      }

      this.logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        if (parsed.thought) {
          yield ctx.agentThoughtEvent(parsed.thought);
        }
        yield ctx.agentStreamEvent(parsed.final_answer!);
        yield ctx.agentFinalEvent();
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;

        if (parsed.thought) {
          yield ctx.agentThoughtEvent(parsed.thought);
        }

        yield ctx.agentToolCallEvent(tool, input);

        try {
          const observation = yield* this.executeAction(tool, input, ctx);

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}\n`,
          });
        } catch (error) {
          const observation = `Error executing action ${tool}: ${(error as Error).message}\n`;
          yield ctx.agentToolErrorEvent(tool, observation);

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}`,
          });
        }

        continue;
      }

      const observation = `Unable to parse response: ${content}. Retrying (${i}/${this.maxIterations})...\n`;
      iterMessages.push({
        role: Role.USER,
        content: `Observation: ${observation}`,
      });
    }

    yield ctx.agentErrorEvent('Max iterations reached');
  }

  private buildIterMessages(
    messages: Awaited<ReturnType<Memory['summarize']>>,
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

  private async *executeAction(
    action: string,
    actionInput: Record<string, unknown>,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, string, void> {
    const tool = container.resolve<Tool>(action);
    const generator = tool.call(actionInput, ctx);

    for await (const toolEvent of generator) {
      yield ctx.adaptToolEvent(toolEvent);
      if (toolEvent.type === 'result') {
        return typeof toolEvent.output === 'string'
          ? toolEvent.output
          : JSON.stringify(toolEvent.output);
      }
    }

    throw new Error(`Tool "${action}" did not return a result event`);
  }
}
