import stringWidth from 'string-width';

// Visual cell width — CJK/emoji count as 2, ANSI escapes stripped. Layout must
// use this (not codepoint length) or wide glyphs overflow and desync painted height.
export const visualWidth = (s: string): number => {
  const w = stringWidth(s);
  return w === undefined ? 0 : w;
};

// Truncate s to max visual cells, appending `…` if cut. Plain text only (ANSI breaks).
export const truncate = (s: string, max: number): string => {
  if (max <= 0) return '';
  if (visualWidth(s) <= max) return s;
  const limit = max - 1;
  let out = '';
  for (const ch of s) {
    if (visualWidth(out + ch) > limit) break;
    out += ch;
  }
  return `${out}…`;
};

// Word-wrap with hard-break; wraps by visual cell width so CJK/emoji (2 cells) break correctly.
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    for (const word of para.split(/ +/)) {
      // hard-break a token into chunks each ≤ w visual cells (char-by-char so
      // wide glyphs don't overflow)
      const chunks: string[] = [];
      let cur = '';
      for (const ch of [...word]) {
        if (visualWidth(cur + ch) > w) {
          if (cur) chunks.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) chunks.push(cur);
      for (const token of chunks) {
        const last = out[out.length - 1];
        const fits =
          last !== undefined &&
          last !== '' &&
          visualWidth(last) + 1 + visualWidth(token) <= w;
        if (fits) out[out.length - 1] = `${last} ${token}`;
        else out.push(token);
      }
    }
  }
  return out.length ? out : [''];
}
