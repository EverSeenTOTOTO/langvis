/** @jsxImportSource react */
import { Box as InkBox, Text } from 'ink';
import type { ReactNode } from 'react';

type BorderedBoxProps = {
  title?: string;
  /** Ignored — Ink draws the border from the parent's width. */
  cols?: number;
  fg?: string;
  children?: ReactNode;
};

// A bordered frame with an optional title set into the top border; fills parent width.
export function BorderedBox({
  title,
  fg = 'gray',
  children,
}: BorderedBoxProps) {
  return (
    <InkBox
      flexDirection="column"
      width="100%"
      borderStyle="single"
      borderColor={fg}
    >
      {title && <Text color={fg}>{title}</Text>}
      {children}
    </InkBox>
  );
}
