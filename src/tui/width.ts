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
