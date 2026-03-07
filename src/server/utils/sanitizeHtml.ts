import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const ALLOWED_TAGS = [
  'p',
  'div',
  'span',
  'a',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'pre',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'style'];

// Create JSDOM and DOMPurify instances once at module load time
// Creating JSDOM per call is extremely expensive
const window = new JSDOM('').window;
const purify = DOMPurify(window);

/**
 * Sanitize HTML content using DOMPurify.
 * Preserves safe tags like links, images, and formatting while removing dangerous elements.
 */
export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });
}
