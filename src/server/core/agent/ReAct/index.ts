import { agent } from '@/server/decorator/agenttool';
import { config } from '@/server/decorator/param';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { isEmpty } from 'lodash-es';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { container } from 'tsyringe';
import { Agent } from '..';
import { Tool } from '../../tool';
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

  async streamCall(
    messages: Message[],
    outputWriter: WritableStreamDefaultWriter<StreamChunk>,
    @config() config?: ReActAgentConfig,
  ) {
    const writer = outputWriter;
    const llmCallTool = container.resolve<Tool>(ToolIds.LLM_CALL);

    const iterMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content:
        msg.role === 'assistant'
          ? // 防止提取过的content成为错误示例，还原成JSON格式
            JSON.stringify(
              msg.meta?.steps?.find(
                (each: ReActStep) => 'final_answer' in each,
              ) || {
                final_answer: msg.content,
              },
            )
          : msg.content,
    }));
    const steps: ReActStep[] = [];

    const updateStep = async (step: ReActStep) => {
      steps.push(step);
      await writer.write({ meta: { steps } });
    };

    for (let i = 0; i < this.maxIterations; i++) {
      this.logger.debug('ReAct iter messages: ', iterMessages);

      const response = (await llmCallTool.call({
        messages: iterMessages,
        model: config?.model?.code,
        temperature: config?.model?.temperature,
        stop: ['Observation:', 'Observation：'],
      })) as ChatCompletion;

      const content = response.choices[0]?.message?.content;

      if (!content) {
        await writer.abort(new Error('No response from model'));
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
        await updateStep({ observation });
        continue;
      }

      this.logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        await updateStep(parsed as ReActFinalAnswer);
        await writer.write(parsed.final_answer!);
        await writer.close();
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;

        await updateStep(parsed as ReActAction);

        try {
          const observation = await this.executeAction(tool, input);

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}\n`,
          });
          await updateStep({ observation });
        } catch (error) {
          const observation = `Error executing action ${tool}: ${(error as Error).message}\n`;

          iterMessages.push({
            role: Role.USER,
            content: `Observation: ${observation}`,
          });
          await updateStep({ observation });
        }

        continue;
      }

      await updateStep({
        observation: `Unable to parse response: ${content}. Retrying (${i}/${this.maxIterations})...\n`,
      });
    }

    await writer.abort(new Error('Max iterations reached'));
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
  ): Promise<string> {
    let tool;
    try {
      tool = container.resolve<Tool>(action);
    } catch {
      return `Tool "${action}" not found, available tools: ${this.tools.map(t => `\`${t.config?.name}\``).join(', ')}`;
    }

    try {
      const result = await tool.call(actionInput);

      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
