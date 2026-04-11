import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, MemoryIds, ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Agent } from '../../agent';
import ChildMemory from '../../memory/Child';
import type { AgentCallInput, AgentCallOutput } from './config';
import { createTimeoutController } from '@/server/utils';

@tool(ToolIds.AGENT_CALL)
export default class AgentCallTool extends Tool<
  AgentCallInput,
  AgentCallOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() params: AgentCallInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, AgentCallOutput, void> {
    const { context, query, config: callConfig = {} } = params;
    const { timeout = 60000 } = callConfig;

    // Resolve target agent (always ReAct)
    let agent: Agent;
    try {
      agent = container.resolve<Agent>(AgentIds.REACT);
    } catch {
      return { success: false, error: 'Agent not available' };
    }

    // Create child context with timeout and callId prefix
    const [controller, cleanup] = createTimeoutController(timeout, ctx.signal);
    // Use current callId as prefix for child's callIds
    const childCtx = new ExecutionContext(controller, ctx.currentCallId);

    // Initialize child memory with fabricated history
    const memory = container.resolve<ChildMemory>(MemoryIds.CHILD);
    const baseTime = Date.now();
    const childMessages: import('@/shared/entities/Message').Message[] = [];

    if (agent.systemPrompt.build()) {
      childMessages.push({
        id: generateId('msg'),
        role: Role.SYSTEM,
        content: agent.systemPrompt.build(),
        attachments: null,
        meta: null,
        createdAt: new Date(baseTime),
        conversationId: '',
      });
    }

    if (context) {
      childMessages.push({
        id: generateId('msg'),
        role: Role.USER,
        content: context,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + 1),
        conversationId: '',
      });
    }

    childMessages.push({
      id: generateId('msg'),
      role: Role.USER,
      content: query,
      attachments: null,
      meta: null,
      createdAt: new Date(baseTime + childMessages.length),
      conversationId: '',
    });

    memory.setContext(childMessages);

    // Execute child agent and wrap events
    let content = '';
    try {
      for await (const event of agent.call(memory, childCtx, {})) {
        // Wrap child event in tool_progress
        yield ctx.agentToolProgressEvent(this.id, {
          status: 'agent_event',
          event,
        });

        // Accumulate stream content
        if (event.type === 'stream') {
          content += event.content;
        }

        // Check for errors
        if (event.type === 'error') {
          return { success: false, error: event.error };
        }

        // Check for cancellation
        if (event.type === 'cancelled') {
          return { success: false, error: event.reason };
        }
      }

      return { success: true, content };
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      return { success: false, error: errMsg };
    } finally {
      cleanup();
    }
  }
}
