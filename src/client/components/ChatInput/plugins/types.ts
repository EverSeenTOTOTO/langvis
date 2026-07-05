import type { LexicalEditor } from 'lexical';
import type { ComponentType, ReactNode } from 'react';

/** A matched span within a text node — half-open range [start, end). */
export interface EntityMatch {
  start: number;
  end: number;
}

/** Props passed to a ReplacePlugin / VariablePlugin inline control renderer. */
export interface InlineControlProps {
  /** The kind under which this renderer was registered (ReplacePlugin `name`). */
  kind: string;
  /** The exact matched source text, e.g. `/web-search`. Also the node's text content. */
  text: string;
  /** Optional payload produced by `createData(match)` (ReplacePlugin) or `insert({ data })` (VariablePlugin). */
  data?: unknown;
  /** The DecoratorNode key. */
  nodeKey: string;
  /** The owning Lexical editor. */
  editor: LexicalEditor;
}

/** Caret rect in viewport coordinates, used to anchor the popover (position: fixed). */
export interface CaretCoords {
  left: number;
  top: number;
  bottom: number;
}

export interface ReplacePluginProps {
  /** Registry kind; ties the TextNode transform to its renderer. */
  name: string;
  /** Pattern detecting text to turn into an inline control. Use the global flag to match repeatedly. */
  pattern: RegExp;
  /** Standard React function component rendered inline for each match. */
  contentRender: ComponentType<InlineControlProps>;
  /** Derive a payload from the match (defaults to the whole match array's data). */
  createData?: (match: RegExpExecArray) => unknown;
}

export interface PopoverRenderArgs {
  /** Text typed after the trigger (swallow=false), or '' (swallow=true). */
  query: string;
  /** Close the popover. */
  close: () => void;
  editor: LexicalEditor;
  caret: CaretCoords;
}

export interface PopoverPluginProps {
  /** Character(s) that open the popover when typed at the caret. */
  trigger: string | string[];
  /** Render the popover body. */
  popoverRender: (args: PopoverRenderArgs) => ReactNode;
  /** If true, the trigger character is not inserted into the document. Default false. */
  swallow?: boolean;
  /** Minimum query length (after the trigger) to open. Default 1; set 0 to open on the bare trigger. */
  minLength?: number;
  /** Only trigger at text start or after whitespace (avoids firing inside paths/URLs). Default false. */
  requireBoundary?: boolean;
}

export interface VariableInsertArgs {
  text: string;
  data?: unknown;
}

export interface VariablePopoverRenderArgs extends PopoverRenderArgs {
  /** Insert an inline control at the caret (replaces the trigger+query span), then closes the popover. */
  insert: (args: VariableInsertArgs) => void;
}

export interface VariablePluginProps {
  name: string;
  trigger: string | string[];
  /** Pattern for paste/typed replacement into chips. Pair with a trailing boundary for delimiter-less tokens. */
  pattern: RegExp;
  popoverRender: (args: VariablePopoverRenderArgs) => ReactNode;
  contentRender: ComponentType<InlineControlProps>;
  swallow?: boolean;
  /** Minimum query length (after the trigger) to open. Default 1; set 0 to open on the bare trigger. */
  minLength?: number;
  /** Only trigger at text start or after whitespace. Default false. */
  requireBoundary?: boolean;
  createData?: (match: RegExpExecArray) => unknown;
}
