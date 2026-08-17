import { describe, it, expect } from 'vitest';
import {
  applyKey,
  insertPaste,
  insertTextAt,
  removeRange,
  bufferText,
  emptyBuffer,
  graphemeSpanEnd,
  visualRows,
  caretToXY,
  xyToOffset,
  cellIndexAt,
  pasteLabel,
  queryTokenStart,
  undoKindOf,
  UndoStack,
  KillRing,
} from '@/tui/libs/editor';
import type { Buffer } from '@/tui/libs/editor';

const text = (s: string): Buffer =>
  s === '' ? emptyBuffer() : { segs: [{ kind: 'text', text: s }] };

describe('paste collapse', () => {
  it('keeps a paste at or under the threshold inline as text', () => {
    const small = 'x'.repeat(200);
    const r = insertPaste(emptyBuffer(), 0, small);
    expect(r.buffer.segs[0].kind).toBe('text');
    expect(bufferText(r.buffer)).toBe(small);
  });

  it('collapses a paste above the threshold into one atomic segment', () => {
    const big = 'y'.repeat(201);
    const r = insertPaste(emptyBuffer(), 0, big);
    expect(r.buffer.segs).toHaveLength(1);
    expect(r.buffer.segs[0].kind).toBe('paste');
    expect(bufferText(r.buffer)).toBe(big);
  });

  it('expands the paste back to the full real text at send time', () => {
    const r = insertPaste(text('ab'), 1, 'z'.repeat(300));
    expect(bufferText(r.buffer)).toBe(`a${'z'.repeat(300)}b`);
  });

  it('renders a short label instead of the full blob', () => {
    expect(pasteLabel('z'.repeat(5000))).toContain(
      'z'.repeat(5000).length.toString(),
    );
    expect(pasteLabel('z'.repeat(5000)).length).toBeLessThan(50);
  });

  it('normalizes CRLF/CR inside a paste', () => {
    const r = insertPaste(emptyBuffer(), 0, 'a\r\nb\rc');
    expect(bufferText(r.buffer)).toBe('a\nb\nc');
  });
});

describe('atomic paste editing', () => {
  const withPaste = (): { buffer: Buffer; cursor: number } => {
    // 'a' + paste
    return insertPaste(text('a'), 1, 'x'.repeat(300));
  };

  it('backspace deletes a whole paste segment', () => {
    const { buffer, cursor } = withPaste();
    const r = applyKey('\x7f', buffer, cursor, 40);
    expect(r).not.toBeNull();
    expect(bufferText(r!.buffer)).toBe('a');
    expect(r!.cursor).toBe(1);
  });

  it('Ctrl-w deletes a whole paste segment', () => {
    const { buffer, cursor } = withPaste();
    const r = applyKey('\x17', buffer, cursor, 40);
    expect(r).not.toBeNull();
    expect(bufferText(r!.buffer)).toBe('a');
  });

  it('cannot place a caret inside a paste segment', () => {
    // 'ab' + paste + 'cd': boundaries 0..6; paste occupies unit 2 (after 'ab').
    const r0 = insertPaste(text('ab'), 2, 'x'.repeat(300));
    const cd = typeChars(r0.buffer, r0.cursor, 'cd');
    const buffer = cd.buffer;
    // Caret after the paste (3 units in) must skip straight into 'cd' on right.
    const right = applyKey('\x1b[C', buffer, 3, 40);
    expect(right!.cursor).toBe(4);
    // Left from after 'cd' moves back over it, never resting inside the paste.
    const left = applyKey('\x1b[D', buffer, 6, 40);
    expect(left!.cursor).toBe(5);
  });

  it('typing adjacent to a paste lands in the surrounding text', () => {
    const { buffer, cursor } = withPaste(); // 'a' + paste, cursor at end
    const r = applyKey('z', buffer, cursor, 40);
    expect(r).not.toBeNull();
    expect(bufferText(r!.buffer)).toBe(`a${'x'.repeat(300)}z`);
    expect(r!.buffer.segs[1].kind).toBe('paste');
  });
});

// helper: type s starting at a given caret boundary
function typeChars(
  buffer: Buffer,
  startCursor: number,
  s: string,
): { buffer: Buffer } {
  let b = buffer;
  let c = startCursor;
  for (const ch of s) {
    const r = applyKey(ch, b, c, 40);
    if (!r) throw new Error('insert failed');
    b = r.buffer;
    c = r.cursor;
  }
  return { buffer: b };
}

describe('insertTextAt', () => {
  it('inserts as inline text (no collapse) at the caret and advances the cursor', () => {
    const r = insertTextAt(text('abc'), 1, 'X'.repeat(300));
    expect(bufferText(r.buffer)).toBe(`a${'X'.repeat(300)}bc`);
    expect(r.cursor).toBe(1 + 300);
  });
  it('normalizes line endings', () => {
    expect(bufferText(insertTextAt(emptyBuffer(), 0, 'a\r\nb').buffer)).toBe(
      'a\nb',
    );
  });
});

describe('bufferText', () => {
  it('concatenates real text across text and paste segments', () => {
    const r = insertPaste(text('ab'), 2, 'x'.repeat(300)); // 'ab' + paste
    const out = typeChars(r.buffer, r.cursor, 'cd');
    expect(bufferText(out.buffer)).toBe(`ab${'x'.repeat(300)}cd`);
  });
});

describe('basic text editing still works', () => {
  it('Enter sends when the buffer does not end with a continuation backslash', () => {
    expect(applyKey('\r', text('hello'), 5, 10)?.submit).toBe(true);
  });

  it('Enter with a trailing backslash joins lines', () => {
    const r = applyKey('\r', text('foo\\'), 4, 10);
    expect(r?.submit).toBe(false);
    expect(r?.buffer && bufferText(r.buffer)).toBe('foo\n');
    expect(r?.cursor).toBe(4);
  });

  it('repeated \\-continuation grows lines across empty continuation rows', () => {
    let buf = emptyBuffer();
    let r = applyKey('\\', buf, 0, 10)!;
    buf = r.buffer;
    r = applyKey('\r', buf, r.cursor, 10)!;
    expect(r.submit).toBe(false);
    buf = r.buffer;
    expect(bufferText(buf)).toBe('\n');
    expect(caretToXY(buf, r.cursor, 10).row).toBe(1);
    // Second continuation from the now-empty row.
    r = applyKey('\\', buf, r.cursor, 10)!;
    buf = r.buffer;
    r = applyKey('\r', buf, r.cursor, 10)!;
    expect(r.submit).toBe(false);
    buf = r.buffer;
    expect(bufferText(buf)).toBe('\n\n');
    expect(caretToXY(buf, r.cursor, 10).row).toBe(2);
    expect(visualRows(buf, 10).map(v => v.text)).toEqual(['', '', '']);
  });

  it('visualRows keeps every trailing \\n as a row, not just the last one', () => {
    expect(visualRows(text('a\n'), 20).map(r => r.text)).toEqual(['a', '']);
    expect(visualRows(text('a\n\n'), 20).map(r => r.text)).toEqual([
      'a',
      '',
      '',
    ]);
    expect(visualRows(text('\n\n'), 20).map(r => r.text)).toEqual(['', '', '']);
  });

  it('Ctrl+Enter (kitty CSI-u) also sends', () => {
    expect(applyKey('\x1b[13;5u', text('hi'), 2, 10)?.submit).toBe(true);
  });

  it('backspace deletes before the cursor', () => {
    const r = applyKey('\x7f', text('abc'), 2, 10);
    expect(r?.buffer && bufferText(r.buffer)).toBe('ac');
    expect(r?.cursor).toBe(1);
  });

  it('Ctrl-a / Ctrl-e jump to line start/end', () => {
    expect(applyKey('\x01', text('ab\ncd'), 4, 10)?.cursor).toBe(3);
    expect(applyKey('\x05', text('ab\ncd'), 0, 10)?.cursor).toBe(2);
  });

  it('Home / End jump to buffer start / end', () => {
    expect(applyKey('\x1b[H', text('ab\ncd'), 4, 10)?.cursor).toBe(0);
    expect(applyKey('\x1b[F', text('ab\ncd'), 0, 10)?.cursor).toBe(5);
  });

  it('Ctrl-w deletes the word before the cursor', () => {
    const r = applyKey('\x17', text('foo bar baz'), 8, 20);
    expect(r?.buffer && bufferText(r.buffer)).toBe('foo baz');
    expect(r?.cursor).toBe(4);
  });

  it('Ctrl-u kills to the current line start', () => {
    const r = applyKey('\x15', text('ab\ncd'), 5, 20);
    expect(r?.buffer && bufferText(r.buffer)).toBe('ab\n');
    expect(r?.cursor).toBe(3);
  });

  it('Ctrl-k kills to the current line end', () => {
    const r = applyKey('\x0b', text('ab\ncd'), 1, 20);
    expect(r?.buffer && bufferText(r.buffer)).toBe('a\ncd');
    expect(r?.cursor).toBe(1);
  });

  it('up/down move across wrapped lines keeping the column', () => {
    const value = 'hello world foo bar';
    const w = 7;
    const endXY = caretToXY(text(value), value.length, w);
    const up = applyKey('\x1b[A', text(value), value.length, w);
    expect(up).not.toBeNull();
    expect(up!.cursor).toBe(
      xyToOffset(text(value), endXY.row - 1, endXY.col, w),
    );
    const down = applyKey('\x1b[B', text(value), value.length, w);
    expect(down).not.toBe(null);
    expect(down!.history).toBe('next'); // at last row → history next
  });

  it('Ctrl-p/Ctrl-n move across wrapped lines like the arrows', () => {
    const value = 'hello world foo bar';
    const w = 7;
    const endXY = caretToXY(text(value), value.length, w);
    const up = applyKey('\x10', text(value), value.length, w); // Ctrl-p
    expect(up).not.toBeNull();
    expect(up!.cursor).toBe(
      xyToOffset(text(value), endXY.row - 1, endXY.col, w),
    );
    expect(applyKey('\x0e', text(value), value.length, w)?.history).toBe(
      'next',
    ); // at last row
  });

  it('Up/Ctrl-p at the top row signals history prev instead of moving', () => {
    // Single-line buffer: caret is on the top (and only) row.
    expect(applyKey('\x1b[A', emptyBuffer(), 0, 10)?.history).toBe('prev');
    expect(applyKey('\x10', text('hi'), 0, 10)?.history).toBe('prev');
    // A wrapped buffer's top row also signals prev (regardless of column).
    expect(applyKey('\x1b[A', text('hello world foo bar'), 0, 7)?.history).toBe(
      'prev',
    );
  });

  it('Up/Down still move the caret on a non-boundary row', () => {
    const value = 'hello world foo bar'; // wraps at width 7
    // Caret on the middle row → plain caret move (no history flag), not null.
    const r = applyKey('\x1b[A', text(value), 8, 7);
    expect(r).not.toBeNull();
    expect(r!.history).toBeUndefined();
    const d = applyKey('\x1b[B', text(value), 0, 7);
    expect(d).not.toBeNull();
    expect(d!.history).toBeUndefined();
  });

  it('up clamps the column to a shorter upper line (no swallow to EOF)', () => {
    const buf = text('ab\ncdefg'); // row0 len 2, row1 len 5
    const atEnd = applyKey('\x1b[A', buf, 8, 20); // caret after 'g'
    expect(atEnd!.cursor).toBe(2); // end of 'ab'
  });

  it('a trailing \\n keeps a blank continuation row for the caret', () => {
    expect(visualRows(text('abc\n'), 20).map(r => r.text)).toEqual(['abc', '']);
    expect(caretToXY(text('abc\n'), 4, 20)).toEqual({ row: 1, col: 0 });
  });

  it('inserts printable text at the cursor', () => {
    const r = applyKey('X', text('ab'), 1, 10);
    expect(r?.buffer && bufferText(r.buffer)).toBe('aXb');
    expect(r?.cursor).toBe(2);
  });

  it('ignores control characters not bound', () => {
    expect(applyKey('\x04', text('ab'), 1, 10)).toBe(null);
  });

  it('collapses a large multi-char chunk (tmux paste) into an atomic segment', () => {
    const big = 'z'.repeat(500);
    const r = applyKey(big, text('ab'), 2, 40);
    expect(r).not.toBeNull();
    expect(r!.buffer.segs[1].kind).toBe('paste');
    expect(bufferText(r!.buffer)).toBe(`ab${big}`);
    expect(r!.cursor).toBe(3); // 2 text units + 1 paste unit
  });

  it('keeps a small multi-char chunk inline as text', () => {
    const r = applyKey('hello', emptyBuffer(), 0, 40);
    expect(r!.buffer.segs[0].kind).toBe('text');
    expect(bufferText(r!.buffer)).toBe('hello');
  });

  it('Ctrl-g clears the composed input', () => {
    const r = applyKey('\x07', text('some text'), 5, 40);
    expect(r).not.toBeNull();
    expect(bufferText(r!.buffer)).toBe('');
    expect(r!.cursor).toBe(0);
    expect(r!.submit).toBe(false);
  });
});

describe('queryTokenStart', () => {
  it('finds a bare slash at the start', () => {
    expect(queryTokenStart(text('/'), 1)).toBe(0);
  });
  it('finds the token start after leading whitespace', () => {
    expect(queryTokenStart(text('  /conv'), 7)).toBe(2);
  });
  it('returns null when the caret is not in a boundary slash token', () => {
    expect(queryTokenStart(text('foo/bar'), 7)).toBeNull();
    expect(queryTokenStart(text('hello '), 6)).toBeNull();
    expect(queryTokenStart(emptyBuffer(), 0)).toBeNull();
  });
});

describe('acceptQuery composition (replace trigger + insert)', () => {
  const accept = (buf: Buffer, cursor: number, replacement: string): string => {
    const start = queryTokenStart(buf, cursor);
    const b = start === null ? buf : removeRange(buf, start, cursor);
    const r = insertTextAt(b, start === null ? cursor : start, replacement);
    return bufferText(r.buffer);
  };

  it('replaces a bare `/` trigger', () => {
    expect(accept(text('/'), 1, '/skill ')).toBe('/skill ');
  });
  it('replaces a `/doc` query instead of doubling it', () => {
    expect(accept(text('/doc'), 4, '/skill ')).toBe('/skill ');
  });
  it('replaces a query that follows leading text', () => {
    expect(accept(text('say /doc'), 8, '/skill ')).toBe('say /skill ');
  });
});

describe('rendering helpers', () => {
  it('visualRows keeps a paste label on a single row', () => {
    const r0 = insertPaste(text('ab'), 2, 'x'.repeat(300));
    const rows = visualRows(r0.buffer, 10);
    expect(rows.map(row => row.text).join('\n')).toContain(
      pasteLabel('x'.repeat(300)),
    );
  });

  it('caretToXY maps an offset to a row/col within wrapped text', () => {
    const cols = caretToXY(text('hello world foo bar'), 8, 7);
    expect(cols).toEqual({ row: 1, col: 1 });
  });

  it('xyToOffset round-trips via caretToXY', () => {
    const value = 'hello world foo bar';
    expect(xyToOffset(text(value), 1, 0, 7)).toBe(7);
    expect(xyToOffset(text(value), 1, 4, 7)).toBe(11);
    expect(xyToOffset(text(value), 2, 5, 7)).toBe(value.length);
  });

  it('clamps row and col into range', () => {
    expect(xyToOffset(text('ab'), 99, 99, 10)).toBe(2);
    expect(xyToOffset(text('ab'), -1, 0, 10)).toBe(0);
  });

  it('cellIndexAt finds the char index at a visual col', () => {
    expect(cellIndexAt('hello', 3)).toBe(3);
  });
});

describe('grapheme editing', () => {
  // 'ab😀' — the emoji is one grapheme spanning units 2..3.
  const emojiEnd = text('ab😀');

  it('backspace deletes a surrogate-pair emoji whole', () => {
    const r = applyKey('\x7f', emojiEnd, 4, 40)!;
    expect(bufferText(r.buffer)).toBe('ab');
    expect(r.cursor).toBe(2);
  });

  it('backspace deletes base+combining-mark whole', () => {
    // 'x' + U+0301 is one cluster of two units.
    const r = applyKey('\x7f', text('á'), 2, 40)!;
    expect(bufferText(r.buffer)).toBe('');
    expect(r.cursor).toBe(0);
  });

  it('left arrow skips over a whole emoji', () => {
    const r = applyKey('\x1b[D', emojiEnd, 4, 40)!;
    expect(r.cursor).toBe(2);
    expect(applyKey('\x1b[D', r.buffer, r.cursor, 40)!.cursor).toBe(1);
  });

  it('right arrow lands on cluster starts, never mid-cluster', () => {
    let cursor = 0;
    const steps: number[] = [];
    for (let i = 0; i < 4; i++) {
      cursor = applyKey('\x1b[C', emojiEnd, cursor, 40)!.cursor;
      steps.push(cursor);
    }
    // Steps past the emoji jump 2 → 4; 3 (mid-pair) never appears.
    expect(steps).toEqual([1, 2, 4, 4]);
  });

  it('graphemeSpanEnd covers a full emoji or flag cluster', () => {
    expect(graphemeSpanEnd('a😀b', 1)).toBe(3);
    expect(graphemeSpanEnd('🇺🇸x', 0)).toBe(4);
    expect(graphemeSpanEnd('abc', 1)).toBe(2);
  });

  it('xyToOffset snaps a mid-cluster col to the cluster start', () => {
    // The flag is one 4-unit cluster rendered as 2 cells; col 1 falls inside
    // it — the caret must land at the flag's start, not mid-cluster.
    expect(xyToOffset(text('🇺🇸x'), 0, 1, 40)).toBe(0);
    expect(xyToOffset(text('🇺🇸x'), 0, 2, 40)).toBe(4);
  });

  it('ASCII editing is unchanged by the grapheme layer', () => {
    const r = applyKey('\x7f', text('abc'), 3, 40)!;
    expect(bufferText(r.buffer)).toBe('ab');
    expect(r.cursor).toBe(2);
    expect(applyKey('\x1b[D', text('abc'), 3, 40)!.cursor).toBe(2);
  });
});

describe('sticky column', () => {
  const buf = text('abcdef\nx\nghijkl');

  it('vertical moves carry the pre-move column across shorter rows', () => {
    const up1 = applyKey('\x1b[A', buf, 15, 20)!;
    expect(up1.cursor).toBe(8); // row 'x' clamps col 6 to its end
    expect(up1.stickyCol).toBe(6);
    const up2 = applyKey('\x1b[A', up1.buffer, up1.cursor, 20, up1.stickyCol)!;
    expect(up2.cursor).toBe(6); // sticky 6 reaches the end of 'abcdef'
  });

  it('without the sticky column the shorter row col carries on', () => {
    const up1 = applyKey('\x1b[A', buf, 15, 20)!;
    const up2 = applyKey('\x1b[A', up1.buffer, up1.cursor, 20)!;
    expect(up2.cursor).toBe(1);
  });

  it('non-vertical results carry no stickyCol', () => {
    expect(applyKey('\x01', buf, 4, 20)!.stickyCol).toBeUndefined();
    expect(applyKey('x', emptyBuffer(), 0, 20)!.stickyCol).toBeUndefined();
  });
});

describe('word navigation classes', () => {
  it('Ctrl-w deletes by class: word, then punctuation, then word', () => {
    let r = applyKey('\x17', text('foo.bar'), 7, 40)!;
    expect(bufferText(r.buffer)).toBe('foo.');
    r = applyKey('\x17', r.buffer, r.cursor, 40)!;
    expect(bufferText(r.buffer)).toBe('foo');
    r = applyKey('\x17', r.buffer, r.cursor, 40)!;
    expect(bufferText(r.buffer)).toBe('');
  });

  it('Ctrl-w swallows trailing blanks together with the word', () => {
    const r = applyKey('\x17', text('foo bar  '), 9, 40)!;
    expect(bufferText(r.buffer)).toBe('foo ');
    expect(r.cursor).toBe(4);
  });

  it('Ctrl-w at a line start deletes the newline (joins lines)', () => {
    const r = applyKey('\x17', text('ab\ncd'), 3, 40)!;
    expect(bufferText(r.buffer)).toBe('abcd');
    expect(r.cursor).toBe(2);
  });

  it('a paste blob is one word-class unit', () => {
    const r0 = insertPaste(text('a'), 1, 'x'.repeat(300));
    const r = applyKey('\x17', r0.buffer, r0.cursor, 40)!;
    expect(bufferText(r.buffer)).toBe('a');
  });
});

describe('kill reporting', () => {
  it('kills report the removed text and direction', () => {
    expect(applyKey('\x7f', text('abc'), 3, 40)!.killed).toEqual({
      text: 'c',
      dir: 'backward',
    });
    expect(applyKey('\x17', text('foo bar'), 7, 40)!.killed).toEqual({
      text: 'bar',
      dir: 'backward',
    });
    expect(applyKey('\x15', text('ab\ncd'), 5, 40)!.killed).toEqual({
      text: 'cd',
      dir: 'backward',
    });
    expect(applyKey('\x0b', text('ab\ncd'), 1, 40)!.killed).toEqual({
      text: 'b',
      dir: 'forward',
    });
    expect(applyKey('\x1b[D', text('abc'), 3, 40)!.killed).toBeUndefined();
  });
});

describe('UndoStack', () => {
  const snap = (s: string, c: number) => ({ buffer: text(s), cursor: c });

  it('merges consecutive letters into one unit', () => {
    const u = new UndoStack();
    u.push(snap('', 0), 'char');
    u.push(snap('f', 1), 'char');
    u.push(snap('fo', 2), 'char');
    expect(u.undo()).toEqual(snap('', 0));
    expect(u.undo()).toBeNull();
  });

  it('a space opens a unit so one undo removes " word" wholesale', () => {
    const u = new UndoStack();
    u.push(snap('', 0), 'char');
    u.push(snap('foo', 3), 'space');
    u.push(snap('foo ', 4), 'char');
    expect(u.undo()).toEqual(snap('foo', 3));
    expect(u.undo()).toEqual(snap('', 0));
  });

  it('merges consecutive deletes into one unit', () => {
    const u = new UndoStack();
    u.push(snap('foo bar', 7), 'delete');
    u.push(snap('foo ba', 6), 'delete');
    u.push(snap('foo b', 5), 'delete');
    expect(u.undo()).toEqual(snap('foo bar', 7));
    expect(u.undo()).toBeNull();
  });

  it('separates a delete run from the letters before it', () => {
    const u = new UndoStack();
    u.push(snap('foo', 3), 'char');
    u.push(snap('fo', 2), 'delete');
    expect(u.undo()).toEqual(snap('fo', 2));
    expect(u.undo()).toEqual(snap('foo', 3));
  });

  it('undo breaks the merge chain (later letters push again)', () => {
    const u = new UndoStack();
    u.push(snap('', 0), 'char');
    u.undo();
    u.push(snap('x', 1), 'char');
    expect(u.undo()).toEqual(snap('x', 1));
  });
});

describe('KillRing', () => {
  it('consecutive backward kills merge by prepending', () => {
    const r = new KillRing();
    r.kill('bar', 'backward');
    r.kill(' ', 'backward');
    r.kill('foo', 'backward');
    expect(r.current()).toBe('foo bar');
  });

  it('consecutive forward kills merge by appending', () => {
    const r = new KillRing();
    r.kill('foo', 'forward');
    r.kill(' bar', 'forward');
    expect(r.current()).toBe('foo bar');
  });

  it('breakSequence separates kills; rotate walks older entries and wraps', () => {
    const r = new KillRing();
    r.kill('one', 'backward');
    r.breakSequence();
    r.kill('two', 'backward');
    r.breakSequence();
    r.kill('three', 'backward');
    expect(r.current()).toBe('three');
    expect(r.rotate()).toBe('two');
    expect(r.rotate()).toBe('one');
    expect(r.rotate()).toBe('three');
  });

  it('empty text is ignored', () => {
    const r = new KillRing();
    r.kill('', 'backward');
    expect(r.current()).toBe('');
  });
});

describe('undoKindOf', () => {
  it('classifies printable keys, blanks, deletes and pastes', () => {
    expect(undoKindOf('a')).toBe('char');
    expect(undoKindOf(' ')).toBe('space');
    expect(undoKindOf('\r')).toBe('space');
    expect(undoKindOf('\x7f')).toBe('delete');
    expect(undoKindOf('\x17')).toBe('delete');
    expect(undoKindOf('hello')).toBe('paste');
  });
});
