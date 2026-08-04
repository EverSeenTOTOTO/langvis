/** @jsxImportSource react */
import { useEffect, useMemo, useState } from 'react';
import { useTerminalSize } from '@/tui/hooks/useTerminalSize';
import {
  renderMarkdownSync,
  requestMarkdown,
  subscribeMarkdownReady,
} from '@/tui/libs/markdown-cache';
import { Text } from './Text';

type MarkdownProps = {
  text: string;
  width?: number;
  // History mode: render via the async worker cache (never blocks the spinner).
  // Default (live/stream) renders synchronously for immediacy.
  deferred?: boolean;
};

// Markdown → styled ANSI (marked-terminal) fed to Ink's Text. Cached per
// (text, width) so re-renders don't re-parse every message (hot path on long histories).
export function Markdown({ text, width, deferred = false }: MarkdownProps) {
  const { cols } = useTerminalSize();
  const w = width ?? cols;
  const [tick, setTick] = useState(0);
  const ansi = useMemo(
    () =>
      deferred
        ? requestMarkdown(text ?? '', w)
        : renderMarkdownSync(text ?? '', w),
    [deferred, text, w, tick],
  );
  useEffect(() => {
    if (!deferred || ansi !== null) return;
    return subscribeMarkdownReady(() => setTick(t => t + 1));
  }, [deferred, ansi]);
  if (!text) return null;
  if (deferred && ansi === null) return null;
  return <Text>{ansi ?? ''}</Text>;
}
