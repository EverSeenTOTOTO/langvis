import { describe, it, expect } from 'vitest';
import {
  emptyHistoryState,
  historyStep,
  type HistoryState,
} from '@/tui/libs/history';

const HIST = ['first', 'second', 'third']; // oldest → newest
// The draft slot is pos === history.length.
const atDraft = (): HistoryState => ({ pos: HIST.length, draft: '' });

describe('historyStep', () => {
  it('empty history is a no-op for both directions', () => {
    const s = emptyHistoryState();
    expect(historyStep(s, 'prev', [], 'draft')).toEqual({
      state: s,
      text: null,
    });
    expect(historyStep(s, 'next', [], 'draft')).toEqual({
      state: s,
      text: null,
    });
  });

  it('prev from the draft captures currentText and shows the newest entry', () => {
    const r = historyStep(atDraft(), 'prev', HIST, 'my draft');
    expect(r.state.pos).toBe(2);
    expect(r.state.draft).toBe('my draft');
    expect(r.text).toBe('third');
  });

  it('repeated prev walks toward the oldest, then stops', () => {
    let s = atDraft();
    s = historyStep(s, 'prev', HIST, '').state; // pos2 → third
    s = historyStep(s, 'prev', HIST, '').state; // pos1 → second
    const oldest = historyStep(s, 'prev', HIST, '');
    expect(oldest.state.pos).toBe(0);
    expect(oldest.text).toBe('first');
    const again = historyStep(oldest.state, 'prev', HIST, '');
    expect(again.text).toBeNull();
    expect(again.state).toEqual(oldest.state);
  });

  it('next walks forward then restores the captured draft at the draft slot', () => {
    let s = atDraft();
    s = historyStep(s, 'prev', HIST, 'my draft').state; // pos2 → third
    s = historyStep(s, 'prev', HIST, '').state; // pos1 → second
    const fwd = historyStep(s, 'next', HIST, '');
    expect(fwd.state.pos).toBe(2);
    expect(fwd.text).toBe('third');
    const toDraft = historyStep(fwd.state, 'next', HIST, '');
    expect(toDraft.state.pos).toBe(3);
    expect(toDraft.text).toBe('my draft');
  });

  it('next at the draft is a no-op', () => {
    const s = atDraft();
    const r = historyStep(s, 'next', HIST, '');
    expect(r.text).toBeNull();
    expect(r.state).toEqual(s);
  });

  it('restores the captured draft, not the edited line, after editing a history entry', () => {
    let s = atDraft();
    s = historyStep(s, 'prev', HIST, 'original draft').state; // pos2, draft saved
    s = historyStep(s, 'prev', HIST, '').state; // pos1
    const back = historyStep(s, 'next', HIST, '').state; // pos2
    const toDraft = historyStep(back, 'next', HIST, '');
    expect(toDraft.text).toBe('original draft');
  });

  it('clamps a stale pos beyond a shrunk history without crashing', () => {
    // pos points past the end (e.g. history shrank via reconcile while mid-nav).
    const stale: HistoryState = { pos: 10, draft: 'kept' };
    const r = historyStep(stale, 'prev', ['only'], '');
    expect(r.state.pos).toBe(0);
    expect(r.text).toBe('only');
  });

  it('emptyHistoryState returns the sentinel draft slot for an empty history', () => {
    const s = emptyHistoryState();
    expect(s.pos).toBe(0);
    expect(s.draft).toBe('');
  });
});
