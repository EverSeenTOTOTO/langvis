/** @jsxImportSource react */
import { Box, Text } from 'ink';

type ProgressProps = {
  value: number;
  max: number;
  width?: number;
  showPct?: boolean;
};

// Horizontal block bar: `████░░░░ NN%`. Color steps green → yellow → red by pct.
export function Progress({
  value,
  max,
  width = 16,
  showPct = true,
}: ProgressProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * width);
  const color = ratio < 0.7 ? 'green' : ratio < 0.9 ? 'yellow' : 'red';
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return (
    <Box>
      <Text color={color}>{bar}</Text>
      {showPct && <Text color="gray">{` ${Math.round(ratio * 100)}%`}</Text>}
    </Box>
  );
}
