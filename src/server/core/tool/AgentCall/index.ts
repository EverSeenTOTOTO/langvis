import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Message, Role } from '@/shared/entities/Message';
import { generateId } from '@/shared/utils';
import { container, inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import { AgentRun } from '@/server/modules/agent/domain/agent-run.entity';
import {
  MEMORY_SERVICE,
  CACHE_PORT,
} from '@/server/modules/agent/agent.di-tokens';
import type { MemoryService } from '@/server/modules/memory/domain/memory-service';
import type { CachePort } from '@/server/modules/memory/ports/cache.port';
import { Agent } from '@/server/modules/agent/domain/agent.base';
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

  constructor(
    @inject(MEMORY_SERVICE) private memoryService: MemoryService,
    @inject(CACHE_PORT) private cachePort: CachePort,
  ) {
    super();
  }

  async *call(
    @input() params: AgentCallInput,
    ctx: { signal: AbortSignal },
  ): AsyncGenerator<
    { type: 'tool_progress'; data: unknown },
    AgentCallOutput,
    void
  > {
    const { context, query, config: callConfig = {} } = params;
    const { timeout = 600_000 } = callConfig;

    let agent: Agent;
    try {
      agent = container.resolve<Agent>(AgentIds.REACT);
    } catch {
      return { success: false, error: 'Agent not available' };
    }

    const systemPrompt = agent.systemPrompt.build();

    const [, cleanup] = createTimeoutController(timeout, ctx.signal);

    const baseTime = Date.now();
    const childMessages: Message[] = [];

    if (systemPrompt) {
      childMessages.push({
        id: generateId('msg'),
        role: Role.SYSTEM,
        content: systemPrompt,
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

    const childRun = new AgentRun(
      generateId('run'),
      '',
      {
        agentId: AgentIds.REACT,
        agentName: 'ReAct',
        systemPrompt,
        tools: [],
        contextSize: 128_000,
        runtimeConfig: {},
      },
      this.memoryService,
      this.cachePort,
      childMessages,
    );

    yield {
      type: 'tool_progress' as const,
      data: { status: 'agent_start', agentId: AgentIds.REACT, context, query },
    };

    let content = '';
    try {
      for await (const event of agent.call(childRun)) {
        yield {
          type: 'tool_progress' as const,
          data: { status: 'agent_event', event },
        };

        if (event.type === 'text_chunk') {
          content += event.content;
        }

        if (event.type === 'error') {
          return { success: false, error: event.error };
        }

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

  override summarizeArgs(args: Record<string, unknown>): string {
    const query = typeof args.query === 'string' ? args.query : '';
    const preview = query.length > 30 ? `${query.slice(0, 30)}...` : query;
    return `(${preview})`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as AgentCallOutput | undefined;
    if (!result) return '完成';
    if (!result.success) return `失败 - ${result.error}`;
    return result.success ? '成功' : '失败';
  }
}
