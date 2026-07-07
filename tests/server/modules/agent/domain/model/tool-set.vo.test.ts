import { describe, it, expect } from 'vitest';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';

describe('ToolSet', () => {
  const members = [
    { id: 'ask_user', mode: 'inline' as const },
    { id: 'response_user', mode: 'inline' as const },
    { id: 'bash', mode: 'listed' as const },
    { id: 'web_fetch', mode: 'listed' as const },
  ];

  it('preserves inline-then-listed construction order in memberIds', () => {
    expect(ToolSet.of(members).memberIds()).toEqual([
      'ask_user',
      'response_user',
      'bash',
      'web_fetch',
    ]);
  });

  it('splits inline and listed ids, each preserving order', () => {
    const ts = ToolSet.of(members);
    expect(ts.inlineIds()).toEqual(['ask_user', 'response_user']);
    expect(ts.listedIds()).toEqual(['bash', 'web_fetch']);
  });

  it('has() is true only for members', () => {
    const ts = ToolSet.of(members);
    expect(ts.has('bash')).toBe(true);
    expect(ts.has('ghost')).toBe(false);
  });

  it('returns skill ids separately from tool members', () => {
    expect(ToolSet.of(members, ['pdf', 'document_archive']).skillIds()).toEqual(
      ['pdf', 'document_archive'],
    );
  });

  it('without() removes matching tools AND skills and returns a new set', () => {
    const ts = ToolSet.of(members, ['pdf']);
    const child = ts.without('ask_user', 'pdf');

    expect(child.has('ask_user')).toBe(false);
    expect(child.has('response_user')).toBe(true);
    expect(child.skillIds()).toEqual([]);
    // original is untouched
    expect(ts.has('ask_user')).toBe(true);
    expect(ts.skillIds()).toEqual(['pdf']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ToolSet.of(members))).toBe(true);
  });
});
