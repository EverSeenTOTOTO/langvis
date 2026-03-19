import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import { compress, resolve } from '@/server/utils/cache';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { isEmpty } from 'lodash-es';
import { container } from 'tsyringe';
import { Agent } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Memory } from '../../memory';
import { Prompt } from '../../PromptBuilder';
import { Tool } from '../../tool';
import { TraceContext } from '../../TraceContext';
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
    code?: string;
    temperature?: number;
  };
}

@agent(AgentIds.REACT)
export default class ReActAgent extends Agent {
  readonly id!: string;
  readonly config!: AgentConfig;
  protected readonly logger!: Logger;
  readonly tools!: Tool[];

  readonly maxIterations: number = 5;

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: ReActAgentConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield ctx.agentStartEvent();

    const messages = await memory.summarize();
    const iterMessages = this.buildIterMessages(messages);

    for (let i = 0; i < this.maxIterations; i++) {
      ctx.signal.throwIfAborted();

      const model = options?.model?.code ?? process.env.OPENAI_MODEL;

      const content = yield* ctx.callLlm({
        messages: iterMessages,
        model,
        temperature: options?.model?.temperature,
        stop: ['Observation:', 'Observation：'],
      });

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

        const observation = yield* this.executeAction(tool, input, ctx);

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

    yield ctx.agentErrorEvent('Max iterations reached');
  }

  private buildIterMessages(
    messages: Message[],
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
    toolName: string,
    toolInput: Record<string, unknown>,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, string, void> {
    try {
      const tool = container.resolve<Tool>(toolName);

      const resolvedInput = await resolve(
        TraceContext.getOrFail().traceId!,
        toolInput,
      );

      yield ctx.agentToolCallEvent(
        toolName,
        resolvedInput as Record<string, unknown>,
      );

      const output = yield* tool.call(
        resolvedInput as Record<string, unknown>,
        ctx,
      );

      const compressedOutput = tool.config?.skipCompression
        ? output
        : await compress(TraceContext.getOrFail().traceId!, output);

      const observation =
        typeof compressedOutput === 'string'
          ? compressedOutput
          : JSON.stringify(compressedOutput);
      yield ctx.agentToolResultEvent(toolName, observation);
      return observation;
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      yield ctx.agentToolErrorEvent(toolName, errMsg);
      throw error;
    }
  }
}
