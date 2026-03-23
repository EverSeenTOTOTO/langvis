import { describe, it, expect } from 'vitest';
import {
  detectAwaitingInputInEvents,
  detectAwaitingInputRecursive,
} from '@/client/pages/Home/components/AgentMessage/utils';
import type { AgentEvent } from '@/shared/types';

describe('detectAwaitingInputInEvents', () => {
  const createEvents = (events: AgentEvent[]): AgentEvent[] => events;

  it('should return null when no awaiting_input event', () => {
    const events = createEvents([
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'some_tool',
        toolArgs: {},
        seq: 2,
        at: Date.now(),
      },
    ]);

    expect(detectAwaitingInputInEvents(events)).toBeNull();
  });

  it('should return awaiting_input data when present', () => {
    const events = createEvents([
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'some_tool',
        toolArgs: {},
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_1',
        toolName: 'some_tool',
        data: {
          status: 'awaiting_input',
          message: 'Please enter your name',
          schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
        seq: 3,
        at: Date.now(),
      },
    ]);

    const result = detectAwaitingInputInEvents(events);
    expect(result).not.toBeNull();
    expect(result?.message).toBe('Please enter your name');
    expect(result?.schema).toBeDefined();
  });

  it('should return null when tool call has tool_result (completed)', () => {
    const events = createEvents([
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'some_tool',
        toolArgs: {},
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_1',
        toolName: 'some_tool',
        data: {
          status: 'awaiting_input',
          message: 'Please enter your name',
          schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'some_tool',
        output: { submitted: true, data: { name: 'John' } },
        seq: 4,
        at: Date.now(),
      },
    ]);

    // After submission, tool_result is emitted, so awaiting_input should not be detected
    expect(detectAwaitingInputInEvents(events)).toBeNull();
  });

  it('should return null when tool call has tool_error', () => {
    const events = createEvents([
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'some_tool',
        toolArgs: {},
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_1',
        toolName: 'some_tool',
        data: {
          status: 'awaiting_input',
          message: 'Please enter your name',
          schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_error',
        callId: 'tc_1',
        toolName: 'some_tool',
        error: 'Timeout',
        seq: 4,
        at: Date.now(),
      },
    ]);

    expect(detectAwaitingInputInEvents(events)).toBeNull();
  });

  it('should still detect awaiting_input for other pending tool calls', () => {
    const events = createEvents([
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'completed_tool',
        toolArgs: {},
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_1',
        toolName: 'completed_tool',
        data: {
          status: 'awaiting_input',
          message: 'Completed input',
          schema: { type: 'object' },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'completed_tool',
        output: { success: true },
        seq: 4,
        at: Date.now(),
      },
      // Second tool call still pending
      {
        type: 'tool_call',
        callId: 'tc_2',
        toolName: 'pending_tool',
        toolArgs: {},
        seq: 5,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_2',
        toolName: 'pending_tool',
        data: {
          status: 'awaiting_input',
          message: 'Pending input',
          schema: { type: 'string' },
        },
        seq: 6,
        at: Date.now(),
      },
    ]);

    // Should still detect awaiting_input for tc_2
    const result = detectAwaitingInputInEvents(events);
    expect(result).not.toBeNull();
    expect(result?.message).toBe('Pending input');
  });
});

describe('detectAwaitingInputRecursive', () => {
  it('should detect awaiting_input in nested agent_call events', () => {
    const events: AgentEvent[] = [
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_outer',
        toolName: 'agent_call',
        toolArgs: { agentId: 'nested_agent' },
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_call',
            callId: 'tc_inner',
            toolName: 'human_in_the_loop',
            toolArgs: {},
            seq: 100,
            at: Date.now(),
          },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_progress',
            callId: 'tc_inner',
            toolName: 'human_in_the_loop',
            data: {
              status: 'awaiting_input',
              message: 'Nested input required',
              schema: { type: 'string' },
            },
            seq: 101,
            at: Date.now(),
          },
        },
        seq: 4,
        at: Date.now(),
      },
    ];

    const result = detectAwaitingInputRecursive(events);
    expect(result).not.toBeNull();
    expect(result?.message).toBe('Nested input required');
  });

  it('should not detect awaiting_input in completed nested agent_call', () => {
    const events: AgentEvent[] = [
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_outer',
        toolName: 'agent_call',
        toolArgs: { agentId: 'nested_agent' },
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_call',
            callId: 'tc_inner',
            toolName: 'human_in_the_loop',
            toolArgs: {},
            seq: 100,
            at: Date.now(),
          },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_progress',
            callId: 'tc_inner',
            toolName: 'human_in_the_loop',
            data: {
              status: 'awaiting_input',
              message: 'Nested input required',
              schema: { type: 'string' },
            },
            seq: 101,
            at: Date.now(),
          },
        },
        seq: 4,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_result',
            callId: 'tc_inner',
            toolName: 'human_in_the_loop',
            output: { submitted: true },
            seq: 102,
            at: Date.now(),
          },
        },
        seq: 5,
        at: Date.now(),
      },
    ];

    // Inner tool has result, should not detect awaiting_input
    expect(detectAwaitingInputRecursive(events)).toBeNull();
  });

  it('should detect awaiting_input in 3-level nesting (agent_call -> tool -> ask_user)', () => {
    // Scenario: Parent Agent calls Child Agent, Child Agent calls position_adjust_tool,
    // position_adjust_tool internally calls ask_user (HumanInTheLoop)
    const events: AgentEvent[] = [
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_outer',
        toolName: 'agent_call',
        toolArgs: { agentId: 'child_agent' },
        seq: 2,
        at: Date.now(),
      },
      // Child Agent's tool_call (position_adjust_tool)
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_call',
            callId: 'tc_middle',
            toolName: 'position_adjust_tool',
            toolArgs: {},
            seq: 100,
            at: Date.now(),
          },
        },
        seq: 3,
        at: Date.now(),
      },
      // position_adjust_tool yields awaiting_input (from internal ask_user call)
      // This is wrapped at the same level as tool_call(tc_middle)
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_progress',
            callId: 'tc_middle',
            toolName: 'position_adjust_tool',
            data: {
              status: 'awaiting_input',
              message: '请填写以下仓位调整信息：',
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
            seq: 101,
            at: Date.now(),
          },
        },
        seq: 4,
        at: Date.now(),
      },
    ];

    const result = detectAwaitingInputRecursive(events);
    expect(result).not.toBeNull();
    expect(result?.message).toBe('请填写以下仓位调整信息：');
  });

  it('should not detect awaiting_input when 3-level nested tool is completed', () => {
    // Same scenario but after user submitted
    const events: AgentEvent[] = [
      { type: 'start', seq: 1, at: Date.now() },
      {
        type: 'tool_call',
        callId: 'tc_outer',
        toolName: 'agent_call',
        toolArgs: { agentId: 'child_agent' },
        seq: 2,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_call',
            callId: 'tc_middle',
            toolName: 'position_adjust_tool',
            toolArgs: {},
            seq: 100,
            at: Date.now(),
          },
        },
        seq: 3,
        at: Date.now(),
      },
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_progress',
            callId: 'tc_middle',
            toolName: 'position_adjust_tool',
            data: {
              status: 'awaiting_input',
              message: '请填写以下仓位调整信息：',
              schema: { type: 'object' },
            },
            seq: 101,
            at: Date.now(),
          },
        },
        seq: 4,
        at: Date.now(),
      },
      // After submission, tool_result for tc_middle
      {
        type: 'tool_progress',
        callId: 'tc_outer',
        toolName: 'agent_call',
        data: {
          status: 'agent_event',
          event: {
            type: 'tool_result',
            callId: 'tc_middle',
            toolName: 'position_adjust_tool',
            output: { submitted: true, data: { name: 'John' } },
            seq: 102,
            at: Date.now(),
          },
        },
        seq: 5,
        at: Date.now(),
      },
    ];

    // tc_middle has tool_result, so awaiting_input should not be detected
    expect(detectAwaitingInputRecursive(events)).toBeNull();
  });
});
