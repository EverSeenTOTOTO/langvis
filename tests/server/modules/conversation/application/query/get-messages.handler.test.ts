import { describe, it, expect, vi } from 'vitest';
import { GetMessagesHandler } from '@/server/modules/conversation/application/query/get-messages.handler';
import { GetMessagesQuery } from '@/server/modules/conversation/contracts';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { Role } from '@/shared/entities/Message';
import type { EnrichedEvent } from '@/shared/types/events';

function makeEnriched(event: Record<string, unknown>): EnrichedEvent {
  return { ...event, runId: 'run_1', at: 0 } as EnrichedEvent;
}

describe('GetMessagesHandler', () => {
  it('merges steps/status for assistant messages with an agent run', async () => {
    const messages = [
      { id: 'm1', role: Role.USER, content: 'hi', conversationId: 'conv_1' },
      {
        id: 'm2',
        role: Role.ASSIST,
        content: 'hello',
        agentRunId: 'run_1',
        conversationId: 'conv_1',
      },
    ];
    const messageRepo = {
      findByConversationId: vi.fn().mockResolvedValue(messages),
    } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      findByIds: vi.fn().mockResolvedValue([
        {
          id: 'run_1',
          status: 'completed',
          events: [makeEnriched({ type: 'text_chunk', content: 'hello' })],
        },
      ]),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetMessagesHandler(messageRepo, agentRunRepo);
    const result = await handler.execute(new GetMessagesQuery('conv_1'));

    // 非 assistant 透传
    expect(result[0]).toEqual(messages[0]);
    // assistant 合并 steps（空，无 tool_call）+ status（来自 run.status）
    expect(result[1]).toMatchObject({
      id: 'm2',
      content: 'hello',
      steps: [],
      status: 'completed',
    });
    expect(agentRunRepo.findByIds).toHaveBeenCalledWith(['run_1']);
  });

  it('returns null steps/status when the agent run is missing', async () => {
    const messages = [
      {
        id: 'm2',
        role: Role.ASSIST,
        content: 'hello',
        agentRunId: 'run_missing',
        conversationId: 'conv_1',
      },
    ];
    const messageRepo = {
      findByConversationId: vi.fn().mockResolvedValue(messages),
    } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      findByIds: vi.fn().mockResolvedValue([]),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetMessagesHandler(messageRepo, agentRunRepo);
    const result = await handler.execute(new GetMessagesQuery('conv_1'));

    expect(result[0]).toMatchObject({
      id: 'm2',
      steps: null,
      status: null,
    });
  });

  it('falls back to projected content when message.content is empty', async () => {
    const messages = [
      {
        id: 'm2',
        role: Role.ASSIST,
        content: '',
        agentRunId: 'run_1',
        conversationId: 'conv_1',
      },
    ];
    const messageRepo = {
      findByConversationId: vi.fn().mockResolvedValue(messages),
    } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      findByIds: vi.fn().mockResolvedValue([
        {
          id: 'run_1',
          status: 'completed',
          events: [makeEnriched({ type: 'text_chunk', content: 'projected' })],
        },
      ]),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetMessagesHandler(messageRepo, agentRunRepo);
    const result = await handler.execute(new GetMessagesQuery('conv_1'));

    expect(result[0].content).toBe('projected');
  });
});
