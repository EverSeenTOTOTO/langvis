import { describe, it, expect } from 'vitest';
import {
  buildToolBlocks,
  extractNestedEvents,
  buildToolTimeline,
} from '@/client/pages/Home/components/AgentMessage/utils';
import type { AgentEvent } from '@/shared/types';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';

describe('buildToolBlocks', () => {
  it('should build tool blocks from timeline', () => {
    const timeline: ToolCallTimeline[] = [
      {
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: { arg: 'value' },
        seq: 1,
        at: Date.now(),
        status: 'done',
        output: { result: 'ok' },
        progress: [],
      },
    ];

    const blocks = buildToolBlocks(timeline);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCall.callId).toBe('tc_1');
    expect(blocks[0].isPending).toBe(false);
  });

  it('should mark pending tools correctly', () => {
    const timeline: ToolCallTimeline[] = [
      {
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
        seq: 1,
        at: Date.now(),
        status: 'pending',
        progress: [],
      },
    ];

    const blocks = buildToolBlocks(timeline);
    expect(blocks[0].isPending).toBe(true);
  });
});

describe('extractNestedEvents', () => {
  it('should extract agent_event from progress', () => {
    const nestedEvent: AgentEvent = {
      type: 'tool_call',
      messageId: 'msg-1',
      callId: 'tc_nested',
      toolName: 'nested_tool',
      toolArgs: {},
      seq: 2,
      at: Date.now(),
    };

    const progress = [
      { data: { status: 'agent_event', event: nestedEvent } },
      { data: { status: 'other' } },
    ];

    const events = extractNestedEvents(progress);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
  });
});

describe('buildToolTimeline', () => {
  it('should build timeline from events', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        messageId: 'msg-1',
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      },
      {
        type: 'tool_result',
        messageId: 'msg-1',
        callId: 'tc_1',
        toolName: 'test_tool',
        output: { success: true },
        seq: 2,
        at: Date.now(),
      },
    ];

    const timeline = buildToolTimeline(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].status).toBe('done');
  });
});
