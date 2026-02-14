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
import { ExecutionContext } from '../../context';
import { Memory } from '../../memory';
import { Tool } from '../../tool';
import type LlmCallTool from '../../tool/LlmCall';
import generatePrompt from './prompt';

export type ReActAction = {
  thought?: string;
  action: {
    tool: string;
    input: Record<string, unknown>;
  };
};

export type ReActObservation = {
  observation: string;
};

export type ReActFinalAnswer = {
  thought?: string;
  final_answer: string;
};

export type ReActStep = ReActAction | ReActObservation | ReActFinalAnswer;

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
    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);

    const messages = await memory.summarize();
    const iterMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content:
        msg.role === 'assistant'
          ? JSON.stringify(
              msg.meta?.steps?.find(
                (each: ReActStep) => 'final_answer' in each,
              ) || {
                final_answer: msg.content,
              },
            )
          : msg.content,
    }));

    for (let i = 0; i < this.maxIterations; i++) {
      ctx.signal.throwIfAborted();

      this.logger.debug('ReAct iter messages: ', iterMessages);

      const content = await runTool(
        llmCallTool.call(
          {
            messages: iterMessages,
            model: options?.model?.code,
            temperature: options?.model?.temperature,
            stop: ['Observation:', 'Observation：'],
          },
          ctx,
        ),
      );

      if (!content) {
        yield ctx.agentEvent({
          type: 'error',
          error: 'No response from model',
        });
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
          yield ctx.agentEvent({ type: 'thought', content: parsed.thought });
        }
        yield ctx.agentEvent({ type: 'stream', content: parsed.final_answer! });
        yield ctx.agentEvent({ type: 'final' });
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;

        if (parsed.thought) {
          yield ctx.agentEvent({ type: 'thought', content: parsed.thought });
        }

        yield ctx.agentEvent({
          type: 'tool_call',
          toolName: tool,
          toolArgs: JSON.stringify(input),
        });

        try {
          const observation = yield* this.executeAction(tool, input, ctx);

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}\n`,
          });
        } catch (error) {
          const observation = `Error executing action ${tool}: ${(error as Error).message}\n`;

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

    yield ctx.agentEvent({ type: 'error', error: 'Max iterations reached' });
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
    try {
      const tool = container.resolve<Tool>(action);
      const generator = tool.call(actionInput, ctx);
      let result: string | undefined;

      for await (const toolEvent of generator) {
        yield ctx.adaptToolEvent(toolEvent);
        if (toolEvent.type === 'result') {
          result = toolEvent.output;
        }
      }

      return result ?? '';
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
