import { logger } from '@/server/middleware/logger';
import { AgentMetas, ToolMetas } from '@/shared/constants';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { container, injectable } from 'tsyringe';
import type { Agent, AgentConstructor } from '..';
import type { ChatState } from '../../ChatState';
import { Tool } from '../../tool';
import generateReActPrompt from './prompt';
import LlmCallTool from '../../tool/LlmCall';
import { Role } from '@/shared/entities/Message';

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
    throw new Error('Method not implemented.');
  }

  async streamCall(chatState: ChatState, outputStream: WritableStream) {
    const writer = outputStream.getWriter();
    const llmCallTool = container.resolve<LlmCallTool>(
      ToolMetas.LLM_CALL_TOOL.Name.en,
    );
    const messages = chatState.messages?.slice(0, -1).map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    for (let i = 0; i < this.maxIterations; i++) {
      logger.debug('ReAct iter messages: ', messages);

      const response = (await llmCallTool.call({
        messages,
        temperature: 0,
        stop: ['Observation:', 'Observation：'],
      })) as ChatCompletion;

      const content = response.choices[0]?.message?.content;

      if (!content) {
        await writer.write('No response from model');
        await writer.close();
        return;
      }

      const parsed = this.parseResponse(content);

      logger.info('ReAct parsed response: ', parsed);

      if ('final_answer' in parsed) {
        await writer.write(parsed.final_answer);
        await writer.close();
        return;
      }

      if ('action' in parsed) {
        const { tool, input } = parsed.action;
        await writer.write(`Action: ${tool}\n`);
        await writer.write(`Action Input: ${JSON.stringify(input)}\n`);

        try {
          const observation = await this.executeAction(tool, input);
          const observationContent = `Observation: ${observation}\n`;

          messages.push({
            role: Role.USER,
            content: observationContent,
          });
          await writer.write(observationContent);
        } catch (error) {
          const errorContent = `Observation: Error executing action ${tool}: ${(error as Error).message}\n`;

          await writer.write(errorContent);
          messages.push({
            role: Role.USER,
            content: errorContent,
          });
        }

        continue;
      }

      if ('thought' in parsed) {
        const thoughtContent = `Thought: ${parsed.thought}\n`;

        await writer.write(thoughtContent);
        messages.push({
          role: Role.ASSIST,
          content: thoughtContent,
        });
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
    try {
      // Clean markdown code blocks only at the beginning and end

      let cleanedContent = content

        .trim()

        .replace(/^```json\s*/, '') // Remove ```json at the beginning

        .replace(/\s*```$/, ''); // Remove ``` at the end

      // Find the actual JSON content (from first { to last })

      const firstBrace = cleanedContent.indexOf('{');

      const lastBrace = cleanedContent.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && firstBrace <= lastBrace) {
        cleanedContent = cleanedContent.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(cleanedContent);

      // Validate and return the parsed response with priority order

      // Priority: thought > action > final_answer

      if (parsed.thought !== undefined) {
        return { thought: String(parsed.thought) };
      }

      if (parsed.action !== undefined) {
        if (
          typeof parsed.action === 'object' &&
          parsed.action !== null &&
          typeof parsed.action.tool === 'string' &&
          parsed.action.tool.length > 0 &&
          parsed.action.input !== undefined
        ) {
          return { action: parsed.action };
        }

        throw new Error('Invalid action format: missing or invalid tool/input');
      }

      if (parsed.final_answer !== undefined) {
        return { final_answer: String(parsed.final_answer) };
      }

      // If none of the expected properties are found

      throw new Error(
        'Unrecognized JSON structure: missing thought, action, or final_answer',
      );
    } catch (error) {
      logger.warn('Failed to parse JSON response, treating as thought:', {
        error: error instanceof Error ? error.message : String(error),

        content:
          content.substring(0, 200) + (content.length > 200 ? '...' : ''),
      });

      // Fallback: treat the entire content as a thought

      return { thought: content.trim() };
    }
  }

  private async executeAction(
    action: string,
    actionInput: Record<string, any>,
  ): Promise<string> {
    let tool;
    try {
      tool = container.resolve<Tool>(action);
    } catch {
      return `Tool "${action}" not found, available tools: ${this.tools.map(t => (t.constructor as AgentConstructor).Name).join(';')}`;
    }

    try {
      const result = await tool.call(actionInput);

      return JSON.stringify(result);
    } catch (error) {
      return `Error executing tool "${action}": ${(error as Error).message}`;
    }
  }
}
