import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { container, inject, injectable } from 'tsyringe';
import type {
  Agent,
  AgentCallContext,
  AgentConstructor,
  AgentStreamCallContext,
} from '..';
import LlmCallTool from '../LlmCall';
import generateReActPrompt from './prompt';
import { logger } from '@/server/middleware/logger';
import { AGENT_META } from '@/shared/constants';

export type ReActAgentCallInput = {
  messages?: ChatCompletionMessageParam[];
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
  static readonly Type = AGENT_META.REACT_AGENT.Type;
  static readonly Name = AGENT_META.REACT_AGENT.Name.en; // Access localized name
  static readonly Description = AGENT_META.REACT_AGENT.Description.en; // Access localized description

  private readonly maxIterations = 5;
  public tools: Agent[] = []; // Will be populated dynamically by the container

  // Inject tools automatically
  constructor(@inject(LlmCallTool) private readonly llmCallTool: LlmCallTool) {}

  protected generateToolsDescription(): string {
    return (
      this.tools
        ?.map(tool => {
          const ctor = tool.constructor as AgentConstructor;

          return `+ ${ctor.Name}:\n\t${ctor.Description}`;
        })
        .join('\n') || 'No tools available.'
    );
  }

  async call(): Promise<unknown> {
    throw new Error('Method not implemented.');
  }

  async streamCall(ctx: AgentStreamCallContext, input: ReActAgentCallInput) {
    const prompt = generateReActPrompt({
      background: '',
      tools: this.generateToolsDescription(),
    });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: prompt },
      ...(input.messages || []),
    ];
    const writer = ctx.outputStream.getWriter();

    for (let i = 0; i < this.maxIterations; i++) {
      logger.debug('ReAct initial messages: ', messages);

      const response = await this.llmCallTool.call(ctx, {
        messages,
        temperature: 0,
        stop: ['Observation:', 'Observation：'],
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        await writer.write('No response from model');
        await writer.close();
        return;
      }

      await writer.write(content);
      await writer.write('\n');

      messages.push({
        role: 'assistant',
        content,
      });

      const parsed = this.parseResponse(content);

      logger.info('ReAct parsed response: ', parsed);

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
          const observationContent = `Observation: ${observation}\n`;

          writer.write(observationContent);
          messages.push({
            role: 'user',
            content: observationContent,
          });
        } catch (error) {
          const errorContent = `Observation: Error executing action ${parsed.action}: ${(error as Error).message}\n`;

          writer.write(errorContent);
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

      let actionInput: Record<string, any> = {};

      if (actionInputLine) {
        try {
          const actionInputStr = actionInputLine
            .replace(/action input:\s*/i, '')
            .trim();
          actionInput = JSON.parse(actionInputStr);
        } catch {
          throw new Error('Invalid JSON in Action Input');
        }
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
    let tool;
    try {
      tool = container.resolve<Agent>(action);
    } catch {
      return `Tool "${action}" not found, available tools: ${this.tools.map(t => (t.constructor as AgentConstructor).Name).join(';')}`;
    }

    try {
      const result = await tool.call(ctx, actionInput);

      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
