/** @jsxImportSource react */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { usePaste } from 'ink';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard, useTerminalSize } from '@/tui/hooks';
import { visualWidth } from '../wrap';
import {
  applyKey,
  insertPaste,
  insertTextAt,
  bufferText,
  visualRows,
  caretToXY,
  cellIndexAt,
  type Buffer,
} from '../editor';

/** Imperative handle so an owner can backfill text at the caret (e.g. voice STT). */
export type TextareaHandle = {
  insert: (text: string) => void;
};

type TextareaProps = {
  buffer: Buffer;
  onBufferChange: (buffer: Buffer) => void;
  onSubmit?: (realText: string) => void;
  fg?: string;
  enabled?: boolean;
  /** Prefix on the first row (e.g. '> '). Its width is excluded from wrapping. */
  prompt?: string;
  /** Total width incl. prompt; defaults to the terminal width. */
  width?: number;
};

// Embed a block (reverse-video) caret at a char index of `text`; if caretAt is
// out of range (or -1) the row renders plain.
function caretize(text: string, caretAt: number): string {
  const ci = Math.max(0, Math.min(caretAt, text.length));
  const before = text.slice(0, ci);
  const cell = text.slice(ci, ci + 1) || ' ';
  const after = text.slice(ci + 1);
  return `${before}\x1b[7m${cell}\x1b[27m${after}`;
}

/** Multi-line input: readline keys + bracketed paste + \\-continuation send. */
export const Textarea = forwardRef<TextareaHandle, TextareaProps>(function Textarea(
  {
    buffer,
    onBufferChange,
    onSubmit,
    fg = 'white',
    enabled = true,
    prompt = '> ',
    width,
  },
  ref,
) {
  const { cols } = useTerminalSize();
  const contentWidth = Math.max(1, (width ?? cols) - visualWidth(prompt));
  const [cursor, setCursor] = useState(0);

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
        onBufferChange(r.buffer);
        setCursor(r.cursor);
      },
    }),
    [buffer, cursor, onBufferChange],
  );

  useKeyboard(data => {
    const r = applyKey(data, buffer, cursor, contentWidth);
    if (!r) return;
    if (r.submit) {
      onSubmit?.(bufferText(buffer));
      return;
    }
    if (r.buffer !== buffer) onBufferChange(r.buffer);
    setCursor(r.cursor);
  }, enabled);

  usePaste(
    text => {
      const r = insertPaste(buffer, cursor, text);
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
      {rows.map((r, i) => (
        <Text key={i} fg={fg}>
          {(i === 0 ? prompt : '') +
            (i === caretRow
              ? caretize(r.text, cellIndexAt(r.text, col))
              : r.text)}
        </Text>
      ))}
    </Box>
  );
});
