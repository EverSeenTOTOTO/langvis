// Key-action registry: the one place a raw key data string maps to a named
// action. Multi-encoding (arrow-down vs Ctrl-n) normalizes here, not in consumers.
export type KeyAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'pick'
  | 'esc'
  | 'q'
  | 'close'
  | 'cancel'
  | 'quit'
  | 'expand'
  | 'voice'
  | 'yank'
  | 'yankPop'
  | 'undo'
  | 'space';

export const DEFAULT_BINDINGS: Record<KeyAction, string[]> = {
  up: ['\x1b[A', '\x10'], // arrow-up / Ctrl-p
  down: ['\x1b[B', '\x0e'], // arrow-down / Ctrl-n
  left: ['\x1b[D'],
  right: ['\x1b[C'],
  enter: ['\r'],
  pick: ['\r', '\x1b[13;5u', '\t'], // slash palette select (+ kitty Ctrl-Enter)
  esc: ['\x1b'],
  q: ['q'],
  close: ['\x1b', 'q'], // pickers: Esc or q to dismiss
  cancel: ['\x03'],
  quit: ['\x04'],
  expand: ['\x0f'],
  voice: ['\x12'],
  yank: ['\x19'],
  yankPop: ['\x1by'],
  undo: ['\x1f', '\x1a'], // Ctrl-_ / Ctrl-z
  space: [' '],
};

export function isKey(raw: string, action: KeyAction): boolean {
  return DEFAULT_BINDINGS[action].includes(raw);
}
