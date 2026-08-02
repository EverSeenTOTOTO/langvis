/** @jsxImportSource react */
import { useFrameSequence } from '../hooks';
import { Box } from './Box';
import { Text } from './Text';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Animated braille spinner, bold + bright (`@inkjs/ui`'s themed gray is hard to see); optional label.
export function Spinner({
  label,
  fg = 'cyan',
}: {
  label?: string;
  fg?: string;
}) {
  const frame = useFrameSequence(true, FRAMES, 80);
  return (
    <Box>
      <Text fg={fg} bold>
        {frame}
      </Text>
      {label ? <Text fg={fg}>{` ${label}`}</Text> : null}
    </Box>
  );
}
