import stringWidth from 'string-width';

/** Visual cell width of a string — CJK/emoji count as 2, ANSI escapes are
 * stripped. Returns 0 for empty/undefined. The TUI lays out by visual cells, so
 * wrapping/measure must use this (not codepoint length) or wide glyphs overflow
 * their region and desync the streaming-paint height. */
export const visualWidth = (s: string): number => {
  const w = stringWidth(s);
  return w === undefined ? 0 : w;
};

/** Truncate `s` to `max` visual cells, appending `…` if it was cut. Iterates
 * by codepoint and measures with `visualWidth` so CJK/emoji don't overflow.
 * For plain text only (ANSI escapes are not preserved across the cut). */
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
