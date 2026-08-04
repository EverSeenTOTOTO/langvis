declare module 'marked-terminal' {
  export interface TerminalRendererOptions {
    code?: unknown;
    blockquote?: unknown;
    html?: unknown;
    heading?: unknown;
    firstHeading?: unknown;
    hr?: unknown;
    listitem?: unknown;
    list?: unknown;
    table?: unknown;
    strong?: unknown;
    em?: unknown;
    codespan?: unknown;
    del?: unknown;
    link?: unknown;
    href?: unknown;
    unescape?: boolean;
    emoji?: boolean;
    width?: number;
    showSectionPrefix?: boolean;
    reflowText?: boolean;
    tab?: number | string;
    tableOptions?: Record<string, unknown>;
    [key: string]: unknown;
  }

  // marked's Parser expects a concrete _Renderer, so mirror its method surface.
  export default class TerminalRenderer {
    options: import('marked').MarkedOptions;
    parser: any;
    constructor(
      options?: TerminalRendererOptions,
      highlightOptions?: Record<string, unknown>,
    );
    space(token: unknown): string;
    code(token: unknown): string;
    blockquote(token: unknown): string;
    html(token: unknown): string;
    heading(token: unknown): string;
    hr(token: unknown): string;
    list(token: unknown): string;
    listitem(item: unknown): string;
    checkbox(token: unknown): string;
    paragraph(token: unknown): string;
    table(token: unknown): string;
    tablerow(token: unknown): string;
    tablecell(token: unknown): string;
    strong(token: unknown): string;
    em(token: unknown): string;
    codespan(token: unknown): string;
    br(token: unknown): string;
    del(token: unknown): string;
    link(token: unknown): string;
    image(token: unknown): string;
    text(token: unknown): string;
  }
}
