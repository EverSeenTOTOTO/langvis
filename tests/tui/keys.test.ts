import { describe, it, expect } from 'vitest';
import { DEFAULT_BINDINGS, isKey, type KeyAction } from '@/tui/libs/keys';

describe('isKey multi-encoding normalization', () => {
  it('vertical navigation merges arrow and Ctrl-p/n encodings', () => {
    expect(isKey('\x1b[A', 'up')).toBe(true);
    expect(isKey('\x10', 'up')).toBe(true);
    expect(isKey('\x1b[B', 'down')).toBe(true);
    expect(isKey('\x0e', 'down')).toBe(true);
  });

  it('horizontal navigation uses the arrow codes', () => {
    expect(isKey('\x1b[D', 'left')).toBe(true);
    expect(isKey('\x1b[C', 'right')).toBe(true);
  });

  it('pick covers Enter, kitty Ctrl-Enter and Tab', () => {
    expect(isKey('\r', 'pick')).toBe(true);
    expect(isKey('\x1b[13;5u', 'pick')).toBe(true);
    expect(isKey('\t', 'pick')).toBe(true);
  });

  it('close merges Esc and q, but esc stays q-free', () => {
    expect(isKey('\x1b', 'close')).toBe(true);
    expect(isKey('q', 'close')).toBe(true);
    expect(isKey('\x1b', 'esc')).toBe(true);
    expect(isKey('q', 'esc')).toBe(false);
  });

  it('undo merges Ctrl-_ and Ctrl-z', () => {
    expect(isKey('\x1f', 'undo')).toBe(true);
    expect(isKey('\x1a', 'undo')).toBe(true);
  });

  it('letter q is its own action', () => {
    expect(isKey('q', 'q')).toBe(true);
    expect(isKey('q', 'esc')).toBe(false);
  });
});

describe('isKey negative', () => {
  it('rejects unrelated keys', () => {
    expect(isKey('x', 'cancel')).toBe(false);
    expect(isKey('\x03', 'quit')).toBe(false);
    expect(isKey('\x04', 'expand')).toBe(false);
    expect(isKey('\x1b[B', 'space')).toBe(false);
  });
});

describe('binding table is sound', () => {
  const actions = Object.keys(DEFAULT_BINDINGS) as KeyAction[];

  it('every action has at least one non-empty binding', () => {
    for (const a of actions) {
      expect(DEFAULT_BINDINGS[a].length).toBeGreaterThan(0);
      for (const raw of DEFAULT_BINDINGS[a]) {
        expect(raw).not.toBe('');
      }
    }
  });

  it('every binding round-trips through isKey for its action', () => {
    for (const a of actions) {
      for (const raw of DEFAULT_BINDINGS[a]) {
        expect(isKey(raw, a)).toBe(true);
      }
    }
  });
});
