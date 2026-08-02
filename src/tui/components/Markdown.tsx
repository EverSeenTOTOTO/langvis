/** @jsxImportSource react */
import { useTerminalSize } from '@/tui/hooks';
import { renderMarkdown } from '@/tui/markdown';
import { Text } from './Text';

type MarkdownProps = {
  text: string;
  width?: number;
  theme?: string;
};

/** Markdown → styled ANSI (via streammark), fed verbatim to Ink's Text, whose
 * tokenizer renders the embedded SGR codes. Recomputed each render. */
export function Markdown({ text, width, theme }: MarkdownProps) {
  const { cols } = useTerminalSize();
  if (!text) return null;
  const w = width ?? cols;
  const ansi = renderMarkdown(text, w, theme);
  return <Text>{ansi}</Text>;
}
