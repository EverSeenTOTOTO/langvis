import TurndownService from 'turndown';
import { sanitizeHtml } from './sanitizeHtml';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

const HTML_TAG_RE =
  /<\/?(?:html|body|div|span|p|a|img|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|br|hr|strong|em|b|i|u|code|pre|blockquote|section|article|header|footer|nav|aside|main)\b/i;

export function htmlToMarkdown(html: string): string {
  const text = html?.trim() ?? '';
  if (!text) return '';
  if (!HTML_TAG_RE.test(text)) return text;
  return turndown.turndown(sanitizeHtml(text)).trim();
}
