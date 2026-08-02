import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '@/tui/markdown';

describe('renderMarkdown', () => {
  it('forces color (emits SGR) and trims trailing newlines', () => {
    const out = renderMarkdown('# Hi\n\n**bold**', 40);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // chalk forced to level 3 → styled output carries SGR escapes
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(out)).toBe(true);
    // trailing newline trimmed so the host-ansi region measures the right height
    expect(out.endsWith('\n')).toBe(false);
  });
});
