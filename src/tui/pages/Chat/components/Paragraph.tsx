/** @jsxImportSource react */
import { useMemo } from 'react';
import { useTerminalSize } from '@/tui/hooks/useTerminalSize';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { wrapText } from '../../../libs/wrap';

type ParagraphProps = {
  text: string;
  fg?: string;
  bg?: string;
  /** Leading spaces on each line. */
  indent?: number;
  /** Defaults to the terminal width. */
  width?: number;
};

/** A block of word-wrapped text. Each wrapped line is its own row. */
export function Paragraph({ text, fg, bg, indent = 0, width }: ParagraphProps) {
  const { cols } = useTerminalSize();
  const w = Math.max(1, (width ?? cols) - indent);
  const pad = ' '.repeat(indent);
  // Cache the word-wrap (per-char stringWidth is costly on long text) so
  // re-renders don't re-measure every line.
  const lines = useMemo(() => wrapText(text, w), [text, w]);
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Text key={i} fg={fg} bg={bg}>
          {pad + ln}
        </Text>
      ))}
    </Box>
  );
}
