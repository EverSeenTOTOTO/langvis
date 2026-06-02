import { describe, it, expect } from 'vitest';
import { buildToolBlocks } from '@/client/pages/Home/components/AgentMessage/utils';
import type { UIToolCall } from '@/client/store/modules/message-node';

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
