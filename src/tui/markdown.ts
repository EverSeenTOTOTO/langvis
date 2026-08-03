import './force-color';
import { Lexer, Parser } from 'marked';
import TerminalRenderer from 'marked-terminal';

// GFM must be explicit (marked 15 won't tokenize tables from a bare `{}`).
const OPTIONS = { gfm: true };

// Markdown → styled ANSI via marked + marked-terminal. The renderer is rebuilt
// per width (`reflowText` wraps); `#` prefixes dropped; trailing newlines trimmed.
export function renderMarkdown(md: string, width: number): string {
  const renderer = new TerminalRenderer({
    reflowText: true,
    width,
    showSectionPrefix: false,
  });
  const tokens = Lexer.lex(md, OPTIONS);
  try {
    return new Parser({ renderer, ...OPTIONS })
      .parse(tokens)
      .replace(/\n+$/, '');
  } catch {
    return md;
  }
}
