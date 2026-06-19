import { describe, it, expect } from 'vitest';
import { PendingMessage } from '@/server/modules/conversation/domain/model/pending-message';
import type { RunEvent } from '@/server/modules/conversation/domain/model/pending-message';

function makeEvent(type: string, overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    type,
    at: Date.now(),
    ...overrides,
  };
}

describe('PendingMessage', () => {
  describe('handleEvent', () => {
    describe('text_chunk', () => {
      it('should accumulate content from text_chunk events', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(makeEvent('text_chunk', { content: 'Hello' }));
        pending.handleEvent(makeEvent('text_chunk', { content: ' world' }));

        const snapshot = pending.toSnapshot();
        expect(snapshot.content).toBe('Hello world');
        expect(snapshot.status).toBe('running');
      });
    });

    describe('thought + tool_call + tool_result (ReAct cycle)', () => {
      it('should accumulate a full ReAct step', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(
          makeEvent('thought', { content: 'I should search' }),
        );
        pending.handleEvent(
          makeEvent('tool_call', {
            callId: 'tc_1',
            toolName: 'WebFetch',
            toolArgs: { url: 'https://example.com' },
          }),
        );
        pending.handleEvent(
          makeEvent('tool_result', {
            callId: 'tc_1',
            toolName: 'WebFetch',
            output: 'Page content',
          }),
        );

        const snapshot = pending.toSnapshot();
        expect(snapshot.steps).toHaveLength(1);
        expect(snapshot.steps[0].thought).toBe('I should search');
        expect(snapshot.steps[0].action?.toolName).toBe('WebFetch');
        expect(snapshot.steps[0].observation).toBe('Page content');
      });

      it('should accumulate multiple ReAct steps', () => {
        const pending = new PendingMessage('msg_1');

        // Step 1
        pending.handleEvent(makeEvent('thought', { content: 'Step 1' }));
        pending.handleEvent(
          makeEvent('tool_call', {
            callId: 'tc_1',
            toolName: 'Bash',
            toolArgs: { command: 'ls' },
          }),
        );
        pending.handleEvent(
          makeEvent('tool_result', {
            callId: 'tc_1',
            toolName: 'Bash',
            output: 'file1.txt',
          }),
        );

        // Step 2
        pending.handleEvent(makeEvent('thought', { content: 'Step 2' }));
        pending.handleEvent(
          makeEvent('tool_call', {
            callId: 'tc_2',
            toolName: 'Read',
            toolArgs: { path: 'file1.txt' },
          }),
        );
        pending.handleEvent(
          makeEvent('tool_result', {
            callId: 'tc_2',
            toolName: 'Read',
            output: 'content of file',
          }),
        );

        const snapshot = pending.toSnapshot();
        expect(snapshot.steps).toHaveLength(2);
      });

      it('should append thought content to existing step', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(makeEvent('thought', { content: 'I think' }));
        pending.handleEvent(makeEvent('thought', { content: ' more' }));

        expect(pending.toSnapshot().steps).toHaveLength(0); // not finalized yet
        // But current step has accumulated thought
        // This is verified when step finalizes
        pending.handleEvent(
          makeEvent('tool_call', {
            callId: 'tc_1',
            toolName: 'Tool',
            toolArgs: {},
          }),
        );
        pending.handleEvent(
          makeEvent('tool_result', {
            callId: 'tc_1',
            toolName: 'Tool',
            output: 'result',
          }),
        );

        expect(pending.toSnapshot().steps[0].thought).toBe('I think more');
      });
    });

    describe('tool_error', () => {
      it('should finalize step with error observation', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(makeEvent('thought', { content: 'try it' }));
        pending.handleEvent(
          makeEvent('tool_call', {
            callId: 'tc_1',
            toolName: 'Bash',
            toolArgs: {},
          }),
        );
        pending.handleEvent(
          makeEvent('tool_error', {
            callId: 'tc_1',
            toolName: 'Bash',
            error: 'command failed',
          }),
        );

        const snapshot = pending.toSnapshot();
        expect(snapshot.steps).toHaveLength(1);
        expect(snapshot.steps[0].observation).toContain('Error');
        expect(snapshot.steps[0].observation).toContain('command failed');
      });
    });

    describe('final', () => {
      it('should mark message as completed', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(makeEvent('text_chunk', { content: 'answer' }));
        pending.handleEvent(makeEvent('final'));

        const snapshot = pending.toSnapshot();
        expect(snapshot.status).toBe('completed');
        expect(snapshot.content).toBe('answer');
      });

      it('should finalize any in-progress step', () => {
        const pending = new PendingMessage('msg_1');

        pending.handleEvent(makeEvent('thought', { content: 'thinking' }));
        pending.handleEvent(makeEvent('final'));

        const snapshot = pending.toSnapshot();
        expect(snapshot.steps).toHaveLength(1);
        expect(snapshot.status).toBe('completed');
      });
    });

    describe('error', () => {
      it('should mark message as failed', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('error', { error: 'Something broke' }));

        expect(pending.toSnapshot().status).toBe('failed');
      });
    });

    describe('cancelled', () => {
      it('should mark message as cancelled', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('cancelled', { reason: 'user abort' }));

        expect(pending.toSnapshot().status).toBe('cancelled');
      });
    });

    describe('terminated — event rejection', () => {
      it('should reject events after final', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('final'));
        pending.handleEvent(makeEvent('text_chunk', { content: 'ignored' }));

        expect(pending.toSnapshot().content).toBe('');
        expect(pending.toSnapshot().status).toBe('completed');
      });

      it('should reject events after error', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('error', { error: 'fail' }));
        pending.handleEvent(makeEvent('text_chunk', { content: 'ignored' }));

        expect(pending.toSnapshot().content).toBe('');
      });
    });

    describe('toSnapshot', () => {
      it('should return running status before termination', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('text_chunk', { content: 'partial' }));

        const snapshot = pending.toSnapshot();
        expect(snapshot.messageId).toBe('msg_1');
        expect(snapshot.status).toBe('running');
        expect(snapshot.content).toBe('partial');
        expect(snapshot.steps).toHaveLength(0);
      });

      it('should copy steps array to prevent mutation', () => {
        const pending = new PendingMessage('msg_1');
        pending.handleEvent(makeEvent('thought', { content: 't' }));
        pending.handleEvent(
          makeEvent('tool_result', {
            callId: 'tc_1',
            toolName: 'X',
            output: 'o',
          }),
        );

        const snap1 = pending.toSnapshot();
        const snap2 = pending.toSnapshot();
        expect(snap1.steps).not.toBe(snap2.steps); // different array refs
      });
    });
  });
});
