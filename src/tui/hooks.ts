/** @jsxImportSource react */
import { useInput, useStdout } from 'ink';
import { useEffect, useRef, useState } from 'react';

// Map Ink's (input, key) event to the raw data string screen handlers expect.
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

// Subscribe to keyboard input; the handler is held in a ref so useInput always
// invokes the latest closure (ink's useEffectEvent can freeze on a transient flag).
export function useKeyboard(
  handler: (data: string) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useInput(
    (input, key) => {
      const data = inkToRawData(input, key);
      if (data !== null) handlerRef.current(data);
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

// Cycle frames while active; idle returns frames[0] so callers embed without a branch.
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
  if (frames.length === 0) return '';
  return active ? (frames[i] ?? frames[0]) : frames[0];
}
