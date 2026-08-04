/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { Text } from './Text';
import { useKeyboard } from '../hooks/useKeyboard';

type InputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  fg?: string;
  bg?: string;
  /** Mask the display as bullets (the real value is kept for editing). */
  mask?: boolean;
  /** Defaults to true. Set false to yield the keyboard. */
  enabled?: boolean;
};

type KeyResult = { value: string; cursor: number; submit: boolean } | null;

// Interpret a raw input chunk against value/cursor; null means ignore the key.
function applyKey(data: string, value: string, cursor: number): KeyResult {
  switch (data) {
    case '\r':
      return { value, cursor, submit: true };
    case '\x7f':
    case '\b':
      if (cursor <= 0) return null;
      return {
        value: value.slice(0, cursor - 1) + value.slice(cursor),
        cursor: cursor - 1,
        submit: false,
      };
    case '\x1b[D':
      return { value, cursor: Math.max(0, cursor - 1), submit: false };
    case '\x1b[C':
      return {
        value,
        cursor: Math.min(value.length, cursor + 1),
        submit: false,
      };
    case '\x1b[A':
    case '\x1b[B':
      return null;
    case '\x1b[H':
    case '\x01':
      return { value, cursor: 0, submit: false };
    case '\x1b[F':
    case '\x05':
      return { value, cursor: value.length, submit: false };
    case '\t':
      return {
        value: value.slice(0, cursor) + '  ' + value.slice(cursor),
        cursor: cursor + 2,
        submit: false,
      };
    default:
      if (data.length === 1 && data >= ' ' && data <= '~') {
        return {
          value: value.slice(0, cursor) + data + value.slice(cursor),
          cursor: cursor + 1,
          submit: false,
        };
      }
      return null;
  }
}

// Controlled single-line input with an inline block cursor; its SGR is embedded in the display string.
export function Input({
  value,
  onChange,
  onSubmit,
  placeholder,
  fg = 'white',
  bg,
  mask = false,
  enabled = true,
}: InputProps) {
  const [cursor, setCursor] = useState(value.length);

  useEffect(() => {
    setCursor(c => Math.min(c, value.length));
  }, [value.length]);

  useKeyboard(data => {
    const r = applyKey(data, value, cursor);
    if (!r) return;
    if (r.submit) {
      onSubmit?.(value);
      return;
    }
    if (r.value !== value) onChange(r.value);
    if (r.cursor !== cursor) setCursor(r.cursor);
  }, enabled);

  const text = mask ? '•'.repeat(value.length) : value;
  const empty = value.length === 0 && placeholder;
  const shown = empty ? placeholder! : text;

  // Only the focused (enabled) field renders the cursor, so the active field
  // is visually distinct from disabled ones.
  if (!enabled) {
    return (
      <Text fg={fg} bg={bg}>
        {shown}
      </Text>
    );
  }

  const cur = empty ? 0 : Math.min(cursor, shown.length);
  const before = shown.slice(0, cur);
  const cell = shown.slice(cur, cur + 1);
  const after = shown.slice(cur + 1);
  const cursorCell = cell ? `\x1b[7m${cell}\x1b[27m` : '\x1b[7m \x1b[27m';
  const display = `${before}${cursorCell}${after}`;

  return (
    <Text fg={fg} bg={bg}>
      {display}
    </Text>
  );
}
