// Readline-style input history navigation: a pure state machine driving which
// historical user message (or the current draft) the input shows after Up/Down.

export type HistoryDir = 'prev' | 'next';
export interface HistoryState {
  /** Index into `history`; `pos === history.length` means "at the draft line". */
  pos: number;
  /** The buffer text saved when the user left the draft on the first prev. */
  draft: string;
}

export function emptyHistoryState(): HistoryState {
  return { pos: 0, draft: '' };
}

// Advance `state` one step → the text to place in the input (null = stay put).
// `history` is oldest → newest; `currentText` is captured when leaving the draft.
export function historyStep(
  state: HistoryState,
  dir: HistoryDir,
  history: string[],
  currentText: string,
): { state: HistoryState; text: string | null } {
  // Clamp a stale position after the message array shrank under us (reconcile).
  const pos = Math.min(state.pos, history.length);
  if (history.length === 0) return { state, text: null };

  if (dir === 'prev') {
    if (pos === history.length) {
      // Leaving the draft → remember it, show the newest entry.
      return {
        state: { pos: history.length - 1, draft: currentText },
        text: history[history.length - 1],
      };
    }
    if (pos === 0) return { state, text: null }; // already oldest
    return { state: { ...state, pos: pos - 1 }, text: history[pos - 1] };
  }

  // next
  if (pos === history.length) return { state, text: null }; // at draft
  const nextPos = pos + 1;
  if (nextPos === history.length) {
    // Back to the draft line → restore what was captured on the first prev.
    return { state: { ...state, pos: nextPos }, text: state.draft };
  }
  return { state: { ...state, pos: nextPos }, text: history[nextPos] };
}
