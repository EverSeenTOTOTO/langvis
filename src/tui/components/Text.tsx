/** @jsxImportSource react */
import { Text as InkText } from 'ink';
import type { ReactNode } from 'react';

type TextProps = {
  children?: ReactNode;
  fg?: string;
  bg?: string;
  bold?: boolean;
};

/** Styled text over Ink's Text: fg/bg/bold → color/backgroundColor/bold. */
export function Text({ children, fg, bg, bold }: TextProps) {
  return (
    <InkText color={fg} backgroundColor={bg} bold={bold}>
      {children}
    </InkText>
  );
}
