import { logger } from '@/server/middleware/logger';
import { AgentMetas, ToolMetas } from '@/shared/constants';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { container, injectable } from 'tsyringe';
import type { Agent, AgentConstructor } from '..';
import { Tool } from '../../tool';
import generateReActPrompt from './prompt';
import LlmCallTool from '../../tool/LlmCall';
import { Role, Message } from '@/shared/entities/Message';
import { isEmpty } from 'lodash-es';

export type ReActThought = {
  thought: string;
};

export type ReActAction = {
  action: {
    tool: string;
    input: Record<string, any>;
  };
};

export type ReActObservation = {
  observation: string;
};

export type ReActFinalAnswer = {
  final_answer: string;
};

export type ReActStep =
  | ReActThought
  | ReActAction
  | ReActObservation
  | ReActFinalAnswer;

@injectable()
export default class ReActAgent implements Agent {
  static readonly Name = AgentMetas.REACT_AGENT.Name.en; // Access localized name
  static readonly Description = AgentMetas.REACT_AGENT.Description.en; // Access localized description

  private readonly maxIterations = 5;
  public tools: Agent[] = []; // Will be populated dynamically by the container

  async getSystemPrompt(): Promise<string> {
    return generateReActPrompt({
      background: '',
      tools:
        this.tools
          ?.map(tool => {
            const ctor = tool.constructor as AgentConstructor;

            return `+ ${ctor.Name}:\n\t${ctor.Description}`;
          })
          .join('\n') || 'No tools available.',
    });
  }

  async call(): Promise<unknown> {
    // For now, just throw an error as the main interface is streamCall
    // This could be implemented to return a final result without streaming
    throw new Error('Non-streaming call not implemented.');
  }

  async streamCall(messages: Message[], outputStream: WritableStream) {
    const writer = outputStream.getWriter();
    const llmCallTool = container.resolve<LlmCallTool>(
      ToolMetas.LLM_CALL_TOOL.Name.en,
    );

    // Convert messages to the format expected by LLM
    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    for (let i = 0; i < this.maxIterations; i++) {
      logger.debug('ReAct iter messages: ', conversationMessages);

      const response = (await llmCallTool.call({
        messages: conversationMessages,
        temperature: 0,
        stop: ['Observation:', 'Observation：'],
      })) as ChatCompletion;

      const content = response.choices[0]?.message?.content;

      if (!content) {
        await writer.write('No response from model');
        await writer.close();
        return;
      }

      conversationMessages.push({
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
        const observationContent = `Observation: Error parsing response: ${(error as Error).message}\n`;

        conversationMessages.push({
          role: Role.USER,
          content: observationContent,
        });
        writer.write(observationContent);
        continue;
      }

      logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        await writer.write(parsed.final_answer);
        await writer.close();
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action!;
        await writer.write(`Action: ${tool}\n`);
        await writer.write(`Action Input: ${JSON.stringify(input)}\n`);

        try {
          const observation = await this.executeAction(tool, input);
          const observationContent = `Observation: ${observation}\n`;

          conversationMessages.push({
            role: Role.USER,
            content: observationContent,
          });
          await writer.write(observationContent);
        } catch (error) {
          const errorContent = `Observation: Error executing action ${tool}: ${(error as Error).message}\n`;

          await writer.write(errorContent);
          conversationMessages.push({
            role: Role.USER,
            content: errorContent,
          });
        }

        continue;
      }

      if ('thought' in parsed) {
        const thoughtContent = `Thought: ${parsed.thought}\n`;

        await writer.write(thoughtContent);
        continue;
      }

      writer.write(
        `Unable to parse response: ${content}. Retrying (${i}/${this.maxIterations})...\n`,
      );
    }

    await writer.write('Max iterations reached without final answer.');
    await writer.close();
  }

  private parseResponse(content: string): ReActStep {
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '') // Remove ```json at the beginning
      .replace(/\s*```$/, ''); // Remove ``` at the end

    const parsed = JSON.parse(cleanedContent);

    if (parsed.thought) {
      return { thought: String(parsed.thought) };
    }

    if (parsed.action) {
      if (
        typeof parsed.action === 'object' &&
        parsed.action !== null &&
        typeof parsed.action.tool === 'string' &&
        parsed.action.tool.length > 0 &&
        parsed.action.input
      ) {
        return { action: parsed.action };
      }

      throw new Error('Invalid action format: missing or invalid tool/input');
    }

    if (parsed.final_answer) {
      return { final_answer: String(parsed.final_answer) };
    }

    throw new Error(
      'Unrecognized JSON structure: missing `thought`, `action`, or `final_answer`',
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
      return `Tool "${action}" not found, available tools: ${this.tools.map(t => `\`${(t.constructor as AgentConstructor).Name}\``).join(', ')}`;
    }

    try {
      const result = await tool.call(actionInput);

      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
