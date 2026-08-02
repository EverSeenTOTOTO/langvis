/** @jsxImportSource react */
import { useTerminalSize } from '@/tui/hooks';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { wrapText } from '../wrap';

type ParagraphProps = {
  text: string;
  fg?: string;
  /** Leading spaces on each line. */
  indent?: number;
  /** Defaults to the terminal width. */
  width?: number;
};

/** A block of word-wrapped text. Each wrapped line is its own row. */
export function Paragraph({ text, fg, indent = 0, width }: ParagraphProps) {
  const { cols } = useTerminalSize();
  const w = Math.max(1, (width ?? cols) - indent);
  const pad = ' '.repeat(indent);
  const lines = wrapText(text, w);
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Text key={i} fg={fg}>
          {pad + ln}
        </Text>
      ))}
    </Box>
  );
}
