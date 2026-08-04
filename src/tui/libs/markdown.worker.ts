import { Lexer, Parser } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Off-main-thread markdown→ANSI renderer: the UI thread is never blocked by the
// (potentially large) `marked` reflow. Messages move one per postMessage.

self.onmessage = (
  e: MessageEvent<{ key: string; md: string; width: number }>,
) => {
  const { key, md, width } = e.data;
  const renderer = new TerminalRenderer({
    reflowText: true,
    width,
    showSectionPrefix: false,
  });
  const tokens = Lexer.lex(md, { gfm: true });
  let ansi: string;
  try {
    ansi = new Parser({ renderer, gfm: true } as any)
      .parse(tokens)
      .replace(/\n+$/, '');
  } catch {
    ansi = md;
  }
  self.postMessage({ key, ansi });
};
