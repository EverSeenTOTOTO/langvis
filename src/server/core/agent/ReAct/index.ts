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
import { Memory } from '../../memory';
import { Tool } from '../../tool';
import type LlmCallTool from '../../tool/LlmCall';
import generatePrompt from './prompt';

export type ReActAction = {
  thought?: string;
  action: {
    tool: string;
    input: Record<string, any>;
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
    @config() options?: ReActAgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'start', agentId: this.id };

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
    const steps: ReActStep[] = [];

    for (let i = 0; i < this.maxIterations; i++) {
      signal?.throwIfAborted();

      this.logger.debug('ReAct iter messages: ', iterMessages);

      const content = await runTool(
        llmCallTool.call(
          {
            messages: iterMessages,
            model: options?.model?.code,
            temperature: options?.model?.temperature,
            stop: ['Observation:', 'Observation：'],
          },
          signal,
        ),
      );

      if (!content) {
        yield { type: 'error', error: new Error('No response from model') };
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
        steps.push({ observation });
        yield { type: 'meta', meta: { steps: [...steps] } };
        continue;
      }

      this.logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        steps.push(parsed as ReActFinalAnswer);
        yield { type: 'meta', meta: { steps: [...steps] } };
        yield { type: 'delta', content: parsed.final_answer! };
        yield { type: 'end', agentId: this.id };
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;

        steps.push(parsed as ReActAction);
        yield { type: 'meta', meta: { steps: [...steps] } };

        try {
          const observation = await this.executeAction(tool, input, signal);

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}\n`,
          });
          steps.push({ observation });
          yield { type: 'meta', meta: { steps: [...steps] } };
        } catch (error) {
          const observation = `Error executing action ${tool}: ${(error as Error).message}\n`;

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}`,
          });
          steps.push({ observation });
          yield { type: 'meta', meta: { steps: [...steps] } };
        }

        continue;
      }

      const observation = `Unable to parse response: ${content}. Retrying (${i}/${this.maxIterations})...\n`;
      steps.push({ observation });
      yield { type: 'meta', meta: { steps: [...steps] } };
    }

    yield { type: 'error', error: new Error('Max iterations reached') };
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

  private async executeAction(
    action: string,
    actionInput: Record<string, any>,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const tool = container.resolve<Tool>(action);
      const result = await runTool(tool.call(actionInput, signal));
      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
