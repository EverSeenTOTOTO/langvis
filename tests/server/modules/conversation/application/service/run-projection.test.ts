import { describe, it, expect } from 'vitest';
import {
  projectRun,
  applyEventToView,
  emptyRunView,
  extractChildEvents,
} from '@/server/modules/conversation/application/service/run-projection';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

function ev(event: RunEvent): EnrichedEvent {
  return { ...event, runId: 'run_1', at: Date.now() };
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

  it('folds a tool_call with no preceding thought into its own step', () => {
    const view = projectRun([
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
    ]);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0].thought).toBe('');
    expect(view.steps[0].action?.toolName).toBe('Bash');
    expect(view.steps[0].observation).toBe('file1.txt');
  });

  it('reports awaitingInput while a tool is blocked on awaiting_input', () => {
    const view = projectRun([
      ev({
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'Bash',
        toolArgs: { command: 'date' },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_1',
        data: {
          status: 'awaiting_input',
          message: 'confirm?',
          schema: { type: 'object' },
        },
      }),
    ]);
    expect(view.awaitingInput).not.toBeNull();
    expect(view.awaitingInput?.callId).toBe('tc_1');
    expect(view.awaitingInput?.message).toBe('confirm?');
    // The open (un-finalized) tool_call is still in-flight — it must appear as
    // a pending step so the reconnect snapshot renders it.
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0].action?.toolName).toBe('Bash');
    expect(view.steps[0].completedAt).toBeUndefined();
  });

  it('clears awaitingInput once the awaiting tool resolves', () => {
    const view = projectRun([
      ev({ type: 'tool_call', callId: 'tc_1', toolName: 'Bash', toolArgs: {} }),
      ev({
        type: 'tool_progress',
        callId: 'tc_1',
        data: {
          status: 'awaiting_input',
          message: 'confirm?',
          schema: { type: 'object' },
        },
      }),
      ev({
        type: 'tool_result',
        callId: 'tc_1',
        toolName: 'Bash',
        output: 'done',
      }),
    ]);
    expect(view.awaitingInput).toBeNull();
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

  it('marks action.status pending in-flight, completed on tool_result', () => {
    const inflight = projectRun([
      ev({ type: 'tool_call', callId: 'tc_p', toolName: 'Bash', toolArgs: {} }),
    ]);
    expect(inflight.steps[0].action?.status).toBe('pending');

    const done = projectRun([
      ev({ type: 'tool_call', callId: 'tc_p', toolName: 'Bash', toolArgs: {} }),
      ev({ type: 'tool_result', callId: 'tc_p', toolName: 'Bash', output: 'ok' }),
    ]);
    expect(done.steps[0].action?.status).toBe('completed');
  });

  it('marks action.status failed with error on tool_error', () => {
    const view = projectRun([
      ev({ type: 'tool_call', callId: 'tc_f', toolName: 'Bash', toolArgs: {} }),
      ev({ type: 'tool_error', callId: 'tc_f', toolName: 'Bash', error: 'boom' }),
    ]);
    expect(view.steps[0].action?.status).toBe('failed');
    expect(view.steps[0].action?.error).toBe('boom');
  });

  it('retains non-child tool progress (e.g. Bash stdout/stderr)', () => {
    const view = projectRun([
      ev({ type: 'tool_call', callId: 'tc_b', toolName: 'Bash', toolArgs: {} }),
      ev({
        type: 'tool_progress',
        callId: 'tc_b',
        data: { type: 'stdout', text: 'line1\n' },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_b',
        data: { type: 'stderr', text: 'warn' },
      }),
      ev({ type: 'tool_result', callId: 'tc_b', toolName: 'Bash', output: 'done' }),
    ]);
    const progress = view.steps[0].action?.progress;
    expect(progress).toHaveLength(2);
    expect(progress?.[0]).toEqual({ type: 'stdout', text: 'line1\n' });
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

  it('uses cancelled reason as content', () => {
    const view = projectRun([
      ev({ type: 'start' }),
      ev({ type: 'cancelled', reason: 'user abort' }),
    ]);
    expect(view.content).toBe('user abort');
  });

  it('uses error message as content', () => {
    const view = projectRun([
      ev({ type: 'start' }),
      ev({ type: 'error', error: 'kaboom' }),
    ]);
    expect(view.content).toBe('kaboom');
  });

  it('cancelled/failed overrides partial streamed content', () => {
    const view = projectRun([
      ev({ type: 'text_chunk', content: 'partial answer' }),
      ev({ type: 'cancelled', reason: 'aborted' }),
    ]);
    expect(view.content).toBe('aborted');
  });

  it('returns a fresh steps array each call (no shared mutation)', () => {
    const events = [
      ev({ type: 'thought', content: 't' }),
      ev({ type: 'tool_result', callId: 'tc_1', toolName: 'X', output: 'o' }),
    ];
    expect(projectRun(events).steps).not.toBe(projectRun(events).steps);
  });

  it('ignores tool_progress / start', () => {
    const view = projectRun([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: 'hi' }),
      ev({ type: 'tool_progress', callId: 'tc_1', data: { pct: 50 } }),
    ]);
    expect(view.content).toBe('hi');
    expect(view.steps).toHaveLength(0);
    expect(view.status).toBe('running');
  });

  it('extracts the last process_summary', () => {
    const view = projectRun([
      ev({ type: 'process_summary', summary: 'old' }),
      ev({ type: 'process_summary', summary: 'latest summary' }),
      ev({ type: 'final' }),
    ]);
    expect(view.processSummary).toBe('latest summary');
  });

  it('extracts the last audio event', () => {
    const view = projectRun([
      ev({ type: 'audio', filePath: 'tts/a.mp3', voice: 'V' }),
      ev({ type: 'final' }),
    ]);
    expect(view.audio).toEqual({ filePath: 'tts/a.mp3', voice: 'V' });
  });

  it('defaults processSummary/audio to null when absent', () => {
    const view = projectRun([ev({ type: 'text_chunk', content: 'hi' })]);
    expect(view.processSummary).toBeNull();
    expect(view.audio).toBeNull();
  });

  it('reconstructs call_subagents child progress onto the step action', () => {
    // Parent folds its own tool_progress (child blobs) onto the call_subagents
    // step's action.progress — so historical read-back / snapshot replay show
    // children from the same shape the live SSE path accumulates.
    const view = projectRun([
      ev({
        type: 'tool_call',
        callId: 'tc_sa',
        toolName: 'call_subagents',
        toolArgs: { children: [{ query: 'q1' }, { query: 'q2' }] },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: {
          childRunId: 'run_child_1',
          event: {
            type: 'tool_call',
            toolName: 'response_user',
            toolArgs: { message: 'ok1' },
          },
        },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: { childRunId: 'run_child_1', event: { type: 'final' } },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: {
          childRunId: 'run_child_2',
          event: { type: 'tool_call', toolName: 'web_fetch', toolArgs: {} },
        },
      }),
      ev({
        type: 'tool_result',
        callId: 'tc_sa',
        toolName: 'call_subagents',
        output: { results: [] },
      }),
    ]);

    expect(view.steps).toHaveLength(1);
    const progress = view.steps[0].action?.progress;
    expect(progress).toHaveLength(3);
    expect((progress![0] as { childRunId: string }).childRunId).toBe(
      'run_child_1',
    );
  });

  it('keeps an in-flight call_subagents step with its accumulated child progress', () => {
    // No tool_result yet (run still going) — the open step still carries
    // progress so a reconnect snapshot exposes children.
    const view = projectRun([
      ev({
        type: 'tool_call',
        callId: 'tc_sa',
        toolName: 'call_subagents',
        toolArgs: {},
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: { childRunId: 'run_child_1', event: { type: 'thought' } },
      }),
    ]);

    expect(view.steps).toHaveLength(1);
    expect(view.steps[0].completedAt).toBeUndefined();
    expect(view.steps[0].action?.progress).toHaveLength(1);
  });

  it('incremental fold equals projectRun over every prefix', () => {
    // Exercises every event type so the incremental reducer can't silently
    // diverge from the full-array fold at any prefix length.
    const events: EnrichedEvent[] = [
      ev({ type: 'start' }),
      ev({ type: 'thought', content: 'plan' }),
      ev({ type: 'tool_call', callId: 'tc_1', toolName: 'Bash', toolArgs: {} }),
      ev({
        type: 'tool_progress',
        callId: 'tc_1',
        data: { status: 'awaiting_input', message: 'ok?', schema: { type: 'object' } },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_1',
        data: { childRunId: 'rc1', event: { type: 'thought' } },
      }),
      ev({ type: 'text_chunk', content: 'partial ' }),
      ev({ type: 'tool_result', callId: 'tc_1', toolName: 'Bash', output: { ok: true } }),
      ev({ type: 'text_chunk', content: 'answer' }),
      ev({ type: 'thought', content: 'again' }),
      ev({ type: 'tool_call', callId: 'tc_2', toolName: 'Read', toolArgs: {} }),
      ev({ type: 'tool_error', callId: 'tc_2', toolName: 'Read', error: 'missing' }),
      ev({ type: 'audio', filePath: 'a.mp3', voice: 'V' }),
      ev({ type: 'process_summary', summary: 'sum' }),
      ev({ type: 'final' }),
    ];

    for (let k = 0; k <= events.length; k++) {
      const incremental = emptyRunView();
      for (let i = 0; i < k; i++) applyEventToView(incremental, events[i]);
      expect(incremental).toEqual(projectRun(events.slice(0, k)));
    }
  });

  it('extracts a child run events from parent tool_progress blobs', () => {
    // CallSubagents forwards each child event into the parent as
    // tool_progress { childRunId, event }, plus a once-off { childRunId, brief, query }.
    const parent: EnrichedEvent[] = [
      ev({
        type: 'tool_call',
        callId: 'tc_sa',
        toolName: 'call_subagents',
        toolArgs: {},
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: { childRunId: 'run_a', brief: 'b', query: 'q' },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: {
          childRunId: 'run_a',
          event: ev({ type: 'thought', content: 'child thinks' }),
        },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: {
          childRunId: 'run_b',
          event: ev({ type: 'thought', content: 'other child' }),
        },
      }),
      ev({
        type: 'tool_progress',
        callId: 'tc_sa',
        data: {
          childRunId: 'run_a',
          event: ev({ type: 'text_chunk', content: 'hi' }),
        },
      }),
    ];

    const childA = extractChildEvents(parent, 'run_a');
    expect(childA.map(e => e.type)).toEqual(['thought', 'text_chunk']);
    expect(extractChildEvents(parent, 'run_b').map(e => e.type)).toEqual([
      'thought',
    ]);
    expect(extractChildEvents(parent, 'run_unknown')).toEqual([]);
    // The extracted events project to the child's own view.
    expect(projectRun(childA).content).toBe('hi');
  });
});
