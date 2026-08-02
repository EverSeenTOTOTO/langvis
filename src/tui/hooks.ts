/** @jsxImportSource react */
import { useInput, useStdout } from 'ink';
import { useEffect, useState } from 'react';

/** Map an Ink `(input, key)` event to the raw data string the screen handlers
 * expect ('\r', '\x1b', '\x1b[A', '\x03', '\x7f', '\t', printable chars). */
function inkToRawData(
  input: string,
  key: {
    return?: boolean;
    escape?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    tab?: boolean;
    backspace?: boolean;
    delete?: boolean;
    ctrl?: boolean;
  },
): string | null {
  if (key.return) return '\r';
  if (key.escape) return '\x1b';
  if (key.upArrow) return '\x1b[A';
  if (key.downArrow) return '\x1b[B';
  if (key.rightArrow) return '\x1b[C';
  if (key.leftArrow) return '\x1b[D';
  if (key.tab) return '\t';
  if (key.backspace || key.delete) return '\x7f';
  if (key.ctrl && input) return String.fromCharCode(input.charCodeAt(0) - 96);
  return input || null;
}

/** Subscribe to keyboard input. The handler is read fresh each commit, so it
 * always sees current state — do not memoize. `enabled=false` yields focus. */
export function useKeyboard(
  handler: (data: string) => void,
  enabled = true,
): void {
  useInput(
    (input, key) => {
      const data = inkToRawData(input, key);
      if (data !== null) handler(data);
    },
    { isActive: enabled },
  );
}

/** Track terminal size, re-rendering on resize. */
export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  return {
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  };
}

/** Cycle through `frames` while `active`, ticking on an interval; '' when idle. */
export function useFrameSequence(
  active: boolean,
  frames: readonly string[],
  intervalMs = 120,
): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || frames.length === 0) return;
    const id = setInterval(
      () => setI(v => (v + 1) % frames.length),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [active, intervalMs, frames.length]);
  return active ? (frames[i] ?? '') : '';
}
