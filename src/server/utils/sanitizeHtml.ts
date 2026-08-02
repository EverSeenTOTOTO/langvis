import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const ALLOWED_TAGS = [
  'html',
  'head',
  'body',
  'meta',
  'title',
  'article',
  'section',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
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

// JSDOM/DOMPurify 实例仅在模块加载时创建一次——每次创建代价极高。
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Sanitize HTML with DOMPurify, preserving safe tags while removing dangerous elements.
export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });
}
