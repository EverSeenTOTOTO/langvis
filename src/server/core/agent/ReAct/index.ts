import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { container, injectable } from 'tsyringe';
import type {
  Agent,
  AgentCallContext,
  AgentConstructor,
  AgentStreamCallContext,
} from '..';
import LlmCallTool from '../LlmCall';
import getReActPrompt from './prompt';
import { ToolNames } from '@/server/utils';

// Define the types for ReAct agent
export type ReActAgentCallInput = {
  messages?: ChatCompletionMessageParam[];
  background?: string;
};

export type ReActThought = {
  thought: string;
};

export type ReActAction = {
  action: string;
  actionInput: Record<string, any>;
};

export type ReActObservation = {
  observation: string;
};

export type ReActFinalAnswer = {
  finalAnswer: string;
};

export type ReActStep =
  | ReActThought
  | ReActAction
  | ReActObservation
  | ReActFinalAnswer;

@injectable()
export default class ReActAgent implements Agent {
  static readonly Name = ToolNames.REACT_AGENT;
  static readonly Description =
    'An agent that uses the ReAct framework to interact with tools and provide answers based on reasoning and actions.';

  private readonly maxIterations = 10;

  private readonly tools: Agent[];

  constructor() {
    this.tools = [ToolNames.DATE_TIME_TOOL].map(name =>
      container.resolve<Agent>(name),
    );
  }

  private readonly llmCallTool = container.resolve(LlmCallTool);

  async call(): Promise<unknown> {
    throw new Error('Method not implemented.');
  }

  async streamCall(ctx: AgentStreamCallContext, input: ReActAgentCallInput) {
    const prompt = getReActPrompt({
      background: input.background || '',
      tools:
        this.tools
          ?.map(tool => {
            const ctor = tool.constructor as AgentConstructor;

            return `+ ${ctor.name}: ${ctor.Description}`;
          })
          .join('\n') || 'No tools available.',
    });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: prompt },
      ...(input.messages || []),
    ];

    const writer = ctx.outputStream.getWriter();

    for (let i = 0; i < this.maxIterations; i++) {
      const response = await this.llmCallTool.call(ctx, {
        messages,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        await writer.write('No response from model');
        await writer.close();
        return;
      }

      await writer.write(content);

      messages.push({
        role: 'assistant',
        content,
      });

      const parsed = this.parseResponse(content);

      if ('finalAnswer' in parsed) {
        await writer.close();
        return;
      }

      if ('action' in parsed) {
        try {
          const observation = await this.executeAction(
            ctx,
            parsed.action,
            parsed.actionInput,
          );
          const observationContent = `Observation: ${observation}`;

          messages.push({
            role: 'user',
            content: observationContent,
          });
        } catch (error) {
          const errorContent = `Observation: Error executing action ${parsed.action}: ${(error as Error).message}`;

          messages.push({
            role: 'user',
            content: errorContent,
          });
        }
      }
    }

    await writer.write('Max iterations reached without final answer.');
    await writer.close();
  }

  private parseResponse(content: string): ReActStep {
    const lines = content.trim().split('\n');

    if (lines.length === 0) {
      return { thought: content };
    }

    const firstLine = lines[0].trim().toLowerCase();

    if (firstLine.startsWith('thought:')) {
      return { thought: content };
    }

    if (firstLine.startsWith('action:')) {
      const action = lines[0].replace(/action:\s*/i, '').trim();
      const actionInputLine = lines.find(line =>
        line.toLowerCase().startsWith('action input:'),
      );
      if (!actionInputLine) {
        throw new Error('Action provided without Action Input');
      }
      const actionInputStr = actionInputLine
        .replace(/action input:\s*/i, '')
        .trim();
      let actionInput: Record<string, any>;

      try {
        actionInput = JSON.parse(actionInputStr);
      } catch {
        throw new Error('Invalid JSON in Action Input');
      }

      return { action, actionInput };
    }

    if (firstLine.startsWith('final answer:')) {
      const finalAnswer =
        lines.slice(1).join('\n').trim() ||
        lines[0].replace(/final answer:\s*/i, '').trim();
      return { finalAnswer };
    }

    // Default to thought if format is unclear
    return { thought: content };
  }

  private async executeAction(
    ctx: AgentCallContext,
    action: string,
    actionInput: Record<string, any>,
  ): Promise<string> {
    try {
      const tool = container.resolve<Agent>(action);
      const result = await tool.call(ctx, actionInput);

      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
