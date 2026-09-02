import DOMPurify from 'dompurify';

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

// jsdom 体积大（~75MB 常驻），静态 import 会把它拖进启动基线——首次真正清洗时才加载；
// JSDOM/DOMPurify 实例只建一次，缓存 promise。
let purifyLoader: Promise<ReturnType<typeof DOMPurify>> | null = null;
const loadPurify = () =>
  (purifyLoader ??= import('jsdom').then(({ JSDOM }) =>
    DOMPurify(new JSDOM('').window),
  ));

/** Sanitize HTML with DOMPurify, preserving safe tags while removing dangerous elements. */
export async function sanitizeHtml(html: string): Promise<string> {
  const purify = await loadPurify();
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });
}
