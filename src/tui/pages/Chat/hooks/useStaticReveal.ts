import { useEffect, useRef, useState } from 'react';
import { Role, type Message } from '@/shared/types/entities';
import {
  requestMarkdown,
  subscribeMarkdownReady,
} from '@/tui/libs/markdown-cache';

// Largest contiguous prefix of `items` whose assistant markdown is computed off
// the main thread (worker results grow it, never blocking the spinner).
export function useStaticReveal(
  items: Message[],
  width: number,
  resetKey: string,
  contentOf: (m: Message) => string = m => m.content,
): Message[] {
  const [, setTick] = useState(0);
  useEffect(() => subscribeMarkdownReady(() => setTick(t => t + 1)), []);

  // Re-render on conversation switch even without a cache event, so the first
  // frame of a freshly-switched conv is already sliced (during render).
  const lastKeyRef = useRef(resetKey);
  if (lastKeyRef.current !== resetKey) {
    lastKeyRef.current = resetKey;
    setTick(t => t + 1);
  }

  let revealed = 0;
  for (const m of items) {
    if (
      m.role === Role.ASSIST &&
      contentOf(m) !== '' &&
      requestMarkdown(contentOf(m), width) === null
    ) {
      break;
    }
    revealed++;
  }
  return items.slice(0, revealed);
}
