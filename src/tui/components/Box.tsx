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
export function Box({ children, flexDirection = 'row', ...props }: BoxProps) {
  return (
    <InkBox flexDirection={flexDirection} {...props}>
      {children}
    </InkBox>
  );
}
