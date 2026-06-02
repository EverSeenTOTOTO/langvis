import { describe, it, expect } from 'vitest';
import {
  buildToolBlocks,
  extractNestedEvents,
  buildUIToolCallsFromEvents,
} from '@/client/pages/Home/components/AgentMessage/utils';
import type { UIToolCall } from '@/client/store/modules/message-node';
import type { AgentEvent } from '@/shared/types/events';

describe('buildToolBlocks', () => {
  it('should build tool blocks from UIToolCalls', () => {
    const toolCalls: UIToolCall[] = [
      {
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: { arg: 'value' },
        status: 'completed',
        output: { result: 'ok' },
        progress: [],
      },
    ];

    const blocks = buildToolBlocks(toolCalls);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCall.callId).toBe('tc_1');
    expect(blocks[0].isPending).toBe(false);
  });

  it('should mark pending tools correctly', () => {
    const toolCalls: UIToolCall[] = [
      {
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
        status: 'pending',
        progress: [],
      },
    ];

    const blocks = buildToolBlocks(toolCalls);
    expect(blocks[0].isPending).toBe(true);
  });
});

describe('extractNestedEvents', () => {
  it('should extract agent_event from progress', () => {
    const nestedEvent: AgentEvent = {
      type: 'tool_call',
      runId: 'run_1',
      callId: 'tc_nested',
      toolName: 'nested_tool',
      toolArgs: {},
    };

    const progress = [
      { status: 'agent_event', event: nestedEvent },
      { status: 'other' },
    ];

    const events = extractNestedEvents(progress);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
  });
});

describe('buildUIToolCallsFromEvents', () => {
  it('should build UIToolCalls from events', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        runId: 'run_1',
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
      },
      {
        type: 'tool_result',
        runId: 'run_1',
        callId: 'tc_1',
        toolName: 'test_tool',
        output: { success: true },
      },
    ];

    const toolCalls = buildUIToolCallsFromEvents(events);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].status).toBe('completed');
    expect(toolCalls[0].callId).toBe('tc_1');
  });

  it('should convert error status to failed', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        runId: 'run_1',
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
      },
      {
        type: 'tool_error',
        runId: 'run_1',
        callId: 'tc_1',
        toolName: 'test_tool',
        error: 'something went wrong',
      },
    ];

    const toolCalls = buildUIToolCallsFromEvents(events);
    expect(toolCalls[0].status).toBe('failed');
    expect(toolCalls[0].error).toBe('something went wrong');
  });
});
