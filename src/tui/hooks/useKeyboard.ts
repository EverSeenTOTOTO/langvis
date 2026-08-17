/** @jsxImportSource react */
import { useInput } from 'ink';
import { useRef } from 'react';

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
    meta?: boolean;
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
  if (key.meta && input) return `\x1b${input}`;
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
