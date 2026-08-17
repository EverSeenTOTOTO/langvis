/** @jsxImportSource react */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { usePaste } from 'ink';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { useTerminalSize } from '@/tui/hooks/useTerminalSize';
import { visualWidth } from '../../../libs/wrap';
import {
  applyKey,
  emptyBuffer,
  graphemeSpanEnd,
  insertPaste,
  insertTextAt,
  removeRange,
  bufferText,
  visualRows,
  caretToXY,
  cellIndexAt,
  textBeforeUnit,
  queryTokenStart,
  undoKindOf,
  UndoStack,
  KillRing,
  type Buffer,
} from '../../../libs/editor';
import { computeSlashQuery } from '../../../libs/slash';

// Keys a nav-owning picker (slash palette) takes over; editing ignores them.
const PICKER_KEYS = new Set([
  '\x1b[A',
  '\x1b[B',
  '\x10',
  '\x0e',
  '\r',
  '\x1b[13;5u',
  '\t',
]);

/** Imperative handle so an owner can backfill/replace text at the caret. */
export type TextareaHandle = {
  /** Backfill text at the current caret (e.g. voice STT). */
  insert: (text: string) => void;
  /** Replace the caret-ending `/query` token with `text` (e.g. a picked skill). */
  acceptQuery: (text: string) => void;
  /** Replace the whole input with `text` and park the caret at its end (history). */
  replace: (text: string) => void;
};

type TextareaProps = {
  buffer: Buffer;
  onBufferChange: (buffer: Buffer) => void;
  onSubmit?: (realText: string) => void;
  /** Up/Down pressed at the input's top/bottom boundary: hand nav to the owner. */
  onHistory?: (dir: 'prev' | 'next') => void;
  fg?: string;
  enabled?: boolean;
  /** Prefix on the first row (e.g. '> '). Its width is excluded from wrapping. */
  prompt?: string;
  /** Total width incl. prompt; defaults to the terminal width. */
  width?: number;
  /** When true, Up/Down/Enter are not consumed by editing (a picker owns them). */
  navLocked?: boolean;
  /** Emit the caret-ending `/query` (null when the caret isn't in a slash token). */
  onSlashQuery?: (query: string | null) => void;
};

// Embed a block (reverse-video) caret at a char index of `text`; if caretAt is
// out of range (or -1) the row renders plain.
function caretize(text: string, caretAt: number): string {
  const ci = Math.max(0, Math.min(caretAt, text.length));
  const before = text.slice(0, ci);
  // The caret cell covers the whole grapheme at ci (emoji, base+marks).
  const cell = text.slice(ci, graphemeSpanEnd(text, ci)) || ' ';
  const after = text.slice(ci + cell.length);
  return `${before}\x1b[7m${cell}\x1b[27m${after}`;
}

/** Multi-line input: readline keys + bracketed paste + \\-continuation send. */
export const Textarea = forwardRef<TextareaHandle, TextareaProps>(
  function Textarea(
    {
      buffer,
      onBufferChange,
      onSubmit,
      onHistory,
      fg = 'white',
      enabled = true,
      prompt = '> ',
      width,
      navLocked = false,
      onSlashQuery,
    },
    ref,
  ) {
    const { cols } = useTerminalSize();
    const contentWidth = Math.max(1, (width ?? cols) - visualWidth(prompt));
    const [cursor, setCursor] = useState(0);
    const undoRef = useRef(new UndoStack());
    const ringRef = useRef(new KillRing());
    // Vertical-movement sticky column; span of the last yank (for yank-pop).
    const stickyRef = useRef<number | null>(null);
    const yankRef = useRef<{ start: number; end: number } | null>(null);

    // An external clear (owner resets the buffer) resets the caret to the start.
    useEffect(() => {
      if (buffer.segs.length === 0) setCursor(0);
    }, [buffer]);

    // Backfill at the current caret: advance the internal caret past the insert.
    useImperativeHandle(
      ref,
      () => ({
        insert(text) {
          const r = insertTextAt(buffer, cursor, text);
          undoRef.current.push({ buffer, cursor }, 'paste');
          ringRef.current.breakSequence();
          yankRef.current = null;
          onBufferChange(r.buffer);
          setCursor(r.cursor);
        },
        acceptQuery(text) {
          const start = queryTokenStart(buffer, cursor);
          const b =
            start === null ? buffer : removeRange(buffer, start, cursor);
          const r = insertTextAt(b, start === null ? cursor : start, text);
          undoRef.current.push({ buffer, cursor }, 'paste');
          ringRef.current.breakSequence();
          yankRef.current = null;
          onBufferChange(r.buffer);
          setCursor(r.cursor);
        },
        replace(text) {
          const r = insertTextAt(emptyBuffer(), 0, text);
          undoRef.current.push({ buffer, cursor }, 'paste');
          ringRef.current.breakSequence();
          yankRef.current = null;
          onBufferChange(r.buffer);
          setCursor(r.cursor);
        },
      }),
      [buffer, cursor, onBufferChange],
    );

    // Emit the caret-ending `/query` whenever the buffer or caret moves.
    useEffect(() => {
      onSlashQuery?.(computeSlashQuery(textBeforeUnit(buffer, cursor)));
    }, [buffer, cursor, onSlashQuery]);

    useKeyboard(data => {
      // With the palette open, a picker owns nav/submit — leave them to it.
      if (navLocked && PICKER_KEYS.has(data)) return;
      // Ctrl-y yanks the ring head; Alt-y replaces the last yank with the next
      // older entry (only valid immediately after a yank).
      if (data === '\x19') {
        const t = ringRef.current.current();
        if (t === '') return;
        ringRef.current.breakSequence();
        const r = insertTextAt(buffer, cursor, t);
        undoRef.current.push({ buffer, cursor }, 'paste');
        yankRef.current = { start: cursor, end: r.cursor };
        stickyRef.current = null;
        onBufferChange(r.buffer);
        setCursor(r.cursor);
        return;
      }
      if (data === '\x1by') {
        const y = yankRef.current;
        if (!y) return;
        const t = ringRef.current.rotate();
        if (t === '') return;
        const b = removeRange(buffer, y.start, y.end);
        const r = insertTextAt(b, y.start, t);
        yankRef.current = { start: y.start, end: r.cursor };
        onBufferChange(r.buffer);
        setCursor(r.cursor);
        return;
      }
      // Ctrl-_ and Ctrl-z undo the last edit unit.
      if (data === '\x1f' || data === '\x1a') {
        const snap = undoRef.current.undo();
        if (!snap) return;
        ringRef.current.breakSequence();
        yankRef.current = null;
        stickyRef.current = null;
        onBufferChange(snap.buffer);
        setCursor(snap.cursor);
        return;
      }
      const r = applyKey(data, buffer, cursor, contentWidth, stickyRef.current);
      if (!r) return;
      // A vertical move reports the column to carry; anything else clears it.
      stickyRef.current = r.stickyCol ?? null;
      if (r.history) {
        // Caret hit a boundary: the owner navigates history; leave buffer/caret.
        onHistory?.(r.history);
        return;
      }
      if (r.submit) {
        undoRef.current.reset();
        ringRef.current.breakSequence();
        onSubmit?.(bufferText(buffer));
        return;
      }
      if (r.killed) ringRef.current.kill(r.killed.text, r.killed.dir);
      else ringRef.current.breakSequence();
      if (r.buffer !== buffer) {
        undoRef.current.push({ buffer, cursor }, undoKindOf(data));
        yankRef.current = null;
        onBufferChange(r.buffer);
      }
      setCursor(r.cursor);
    }, enabled);

    usePaste(
      text => {
        const r = insertPaste(buffer, cursor, text);
        undoRef.current.push({ buffer, cursor }, 'paste');
        ringRef.current.breakSequence();
        yankRef.current = null;
        stickyRef.current = null;
        onBufferChange(r.buffer);
        setCursor(r.cursor);
      },
      { isActive: enabled },
    );

    const rows = visualRows(buffer, contentWidth);
    const { row: caretRow, col } = enabled
      ? caretToXY(buffer, cursor, contentWidth)
      : { row: -1, col: 0 };

    return (
      <Box flexDirection="column">
        {rows.map((r, i) => {
          // Ink gives empty <Text> zero height — a bare space keeps blank rows visible.
          const line =
            (i === 0 ? prompt : '') +
            (i === caretRow
              ? caretize(r.text, cellIndexAt(r.text, col))
              : r.text);
          return (
            <Text key={i} fg={fg}>
              {line === '' ? ' ' : line}
            </Text>
          );
        })}
      </Box>
    );
  },
);
