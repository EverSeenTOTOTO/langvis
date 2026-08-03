/** @jsxImportSource react */
import { useTerminalSize } from '@/tui/hooks';
import { renderMarkdown } from '@/tui/markdown';
import { Text } from './Text';

type MarkdownProps = {
  text: string;
  width?: number;
};

// Markdown → styled ANSI (marked-terminal) fed to Ink's Text, which renders the embedded SGR codes.
export function Markdown({ text, width }: MarkdownProps) {
  const { cols } = useTerminalSize();
  if (!text) return null;
  const w = width ?? cols;
  const ansi = renderMarkdown(text, w);
  return <Text>{ansi}</Text>;
}
