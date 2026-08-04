/** @jsxImportSource react */
import { Box as InkBox } from 'ink';
import type { ReactNode } from 'react';

type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';
type AlignItems = 'flex-start' | 'center' | 'flex-end' | 'stretch';
type JustifyContent =
  | 'flex-start'
  | 'flex-end'
  | 'space-between'
  | 'space-around'
  | 'space-evenly'
  | 'center';

type BoxProps = {
  children?: ReactNode;
  flexDirection?: FlexDirection;
  flexGrow?: number;
  flexShrink?: number;
  width?: number | string;
  height?: number | string;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  /** Shorthand for setting both horizontal paddings. */
  paddingX?: number;
  /** Shorthand for setting both vertical paddings. */
  paddingY?: number;
  backgroundColor?: string;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  borderStyle?:
    | 'single'
    | 'double'
    | 'round'
    | 'bold'
    | 'singleDouble'
    | 'doubleSingle'
    | 'classic'
    | 'arrow';
  borderColor?: string;
};

/** Flex container over Ink's Box. Defaults to row (flexbox/Ink convention). */
export function Box({
  children,
  flexDirection = 'row',
  paddingX,
  paddingY,
  ...props
}: BoxProps) {
  return (
    <InkBox
      flexDirection={flexDirection}
      paddingLeft={paddingX}
      paddingRight={paddingX}
      paddingTop={paddingY}
      paddingBottom={paddingY}
      {...props}
    >
      {children}
    </InkBox>
  );
}
