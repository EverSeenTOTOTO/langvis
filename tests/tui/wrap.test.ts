import { describe, it, expect } from 'vitest';
import { wrapText } from '@/tui/libs/wrap';

describe('wrapText', () => {
  it('word-wraps to the given width', () => {
    // "foo bar" is exactly 7 chars → fits at width 7.
    expect(wrapText('hello world foo bar', 7)).toEqual([
      'hello',
      'world',
      'foo bar',
    ]);
  });

  it('keeps a line that fits intact', () => {
    expect(wrapText('one two', 20)).toEqual(['one two']);
  });

  it('hard-breaks tokens longer than the width', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('preserves blank lines', () => {
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('does not merge consecutive lines into one row', () => {
    expect(wrapText('line1\nline2\n\nline4', 20)).toEqual([
      'line1',
      'line2',
      '',
      'line4',
    ]);
  });

  it('starts each paragraph on a fresh row regardless of fit', () => {
    expect(wrapText('abc def\nghi', 10)).toEqual(['abc def', 'ghi']);
  });

  it('returns a single blank for empty input', () => {
    expect(wrapText('', 10)).toEqual(['']);
  });

  it('wraps CJK by visual width (2 cells per glyph)', () => {
    // 13 glyphs = 26 cells → exactly fills width 26; the 14th wraps.
    expect(wrapText('请确认您是否要渲染一个测试表单', 26)).toEqual([
      '请确认您是否要渲染一个测试',
      '表单',
    ]);
  });
});
