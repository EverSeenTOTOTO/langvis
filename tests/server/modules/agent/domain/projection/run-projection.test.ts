import { describe, it, expect } from 'vitest';
import { projectRun } from '@/server/modules/agent/domain/projection/run-projection';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

let seq = 0;
function ev(event: RunEvent): EnrichedEvent {
  return { ...event, runId: 'run_1', seq: ++seq, at: Date.now() };
}

describe('projectRun', () => {
  it('accumulates content from text_chunk events', () => {
    const view = projectRun([
      ev({ type: 'text_chunk', content: 'Hello' }),
      ev({ type: 'text_chunk', content: ' world' }),
    ]);
    expect(view.content).toBe('Hello world');
    expect(view.status).toBe('running');
    expect(view.steps).toHaveLength(0);
  });

  it('folds a full ReAct step (thought + tool_call + tool_result)', () => {
    const view = projectRun([
      ev({ type: 'thought', content: 'I should search' }),
      ev({
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'WebFetch',
        toolArgs: { url: 'https://example.com' },
      }),
      ev({
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'WebFetch',
        output: 'Page content',
      }),
    ]);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0].thought).toBe('I should search');
    expect(view.steps[0].action?.toolName).toBe('WebFetch');
    expect(view.steps[0].observation).toBe('Page content');
  });

  it('folds multiple ReAct steps', () => {
    const view = projectRun([
      ev({ type: 'thought', content: 'Step 1' }),
      ev({
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'Bash',
        toolArgs: { command: 'ls' },
      }),
      ev({
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'Bash',
        output: 'file1.txt',
      }),
      ev({ type: 'thought', content: 'Step 2' }),
      ev({
        type: 'tool_call',
        callId: 'tc_2',
        toolName: 'Read',
        toolArgs: { path: 'f' },
      }),
      ev({
        type: 'tool_result',
        callId: 'tc_2',
        toolName: 'Read',
        output: 'content',
      }),
    ]);
    expect(view.steps).toHaveLength(2);
  });

  it('appends thought content within an open step', () => {
    const view = projectRun([
      ev({ type: 'thought', content: 'I think' }),
      ev({ type: 'thought', content: ' more' }),
      ev({ type: 'tool_call', callId: 'tc_1', toolName: 'Tool', toolArgs: {} }),
      ev({
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'Tool',
        output: 'r',
      }),
    ]);
    expect(view.steps[0].thought).toBe('I think more');
  });

  it('finalizes a step with error observation on tool_error', () => {
    const view = projectRun([
      ev({ type: 'thought', content: 'try it' }),
      ev({ type: 'tool_call', callId: 'tc_1', toolName: 'Bash', toolArgs: {} }),
      ev({
        type: 'tool_error',
        callId: 'tc_1',
        toolName: 'Bash',
        error: 'command failed',
      }),
    ]);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0].observation).toContain('Error');
    expect(view.steps[0].observation).toContain('command failed');
  });

  it('marks completed on final and finalizes in-progress step', () => {
    const view = projectRun([
      ev({ type: 'text_chunk', content: 'answer' }),
      ev({ type: 'thought', content: 'thinking' }),
      ev({ type: 'final' }),
    ]);
    expect(view.status).toBe('completed');
    expect(view.content).toBe('answer');
    expect(view.steps).toHaveLength(1);
  });

  it('marks failed on error event', () => {
    expect(
      projectRun([ev({ type: 'error', error: 'Something broke' })]).status,
    ).toBe('failed');
  });

  it('marks cancelled on cancelled event', () => {
    expect(
      projectRun([ev({ type: 'cancelled', reason: 'user abort' })]).status,
    ).toBe('cancelled');
  });

  it('returns a fresh steps array each call (no shared mutation)', () => {
    const events = [
      ev({ type: 'thought', content: 't' }),
      ev({ type: 'tool_result', callId: 'tc_1', toolName: 'X', output: 'o' }),
    ];
    expect(projectRun(events).steps).not.toBe(projectRun(events).steps);
  });

  it('ignores tool_progress / start / context_usage', () => {
    const view = projectRun([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: 'hi' }),
      ev({ type: 'tool_progress', callId: 'tc_1', data: { pct: 50 } }),
      ev({
        type: 'context_usage',
        used: 10,
        total: 100,
        reason: 'turn_completed',
      }),
    ]);
    expect(view.content).toBe('hi');
    expect(view.steps).toHaveLength(0);
    expect(view.status).toBe('running');
  });
});
