import { describe, expect, it } from 'vitest';
import {
  buildEntries,
  computeSlashQuery,
  filterEntries,
  type SlashEntry,
} from '@/tui/libs/slash';
import type { SkillInfo } from '@/shared/types/agent';

const skill = (id: string, name = id): SkillInfo => ({
  id,
  name,
  description: `${name} does things`,
});

describe('computeSlashQuery', () => {
  it('opens with a bare slash at the caret', () => {
    expect(computeSlashQuery('/')).toBe('');
  });

  it('captures the query after the slash', () => {
    expect(computeSlashQuery('/mod')).toBe('mod');
    expect(computeSlashQuery('  /conv')).toBe('conv');
  });

  it('triggers after whitespace within a line', () => {
    expect(computeSlashQuery('hello /boo')).toBe('boo');
  });

  it('stays closed when the slash is mid-token', () => {
    expect(computeSlashQuery('foo/bar')).toBeNull();
  });

  it('stays closed when there is no slash token', () => {
    expect(computeSlashQuery('')).toBeNull();
    expect(computeSlashQuery('hello world')).toBeNull();
  });

  it('stays closed when the caret is not at the query end', () => {
    // A space after the token ends it.
    expect(computeSlashQuery('/mod ')).toBeNull();
  });
});

describe('buildEntries', () => {
  it('puts config commands first, then skills', () => {
    const entries = buildEntries([skill('doc'), skill('code')]);
    expect(
      entries.map(e => (e.kind === 'cmd' ? e.cmd : `s:${e.skill.id}`)),
    ).toEqual(['conv', 'model', 'new', 'logout', 'help', 's:doc', 's:code']);
  });
});

describe('filterEntries', () => {
  const entries: SlashEntry[] = buildEntries([
    skill('doc', 'Documentation'),
    skill('code', 'Code review'),
  ]);

  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '')).toHaveLength(entries.length);
    expect(filterEntries(entries, '   ')).toHaveLength(entries.length);
  });

  it('matches a config command by token', () => {
    const r = filterEntries(entries, 'mod');
    expect(r.map(e => (e.kind === 'cmd' ? e.cmd : null))).toContain('model');
  });

  it('matches a skill by id', () => {
    const r = filterEntries(entries, 'doc');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'skill', skill: { id: 'doc' } });
  });

  it('matches a skill by name (case-insensitive)', () => {
    const r = filterEntries(entries, 'REVIEW');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'skill', skill: { id: 'code' } });
  });

  it('returns empty when nothing matches', () => {
    expect(filterEntries(entries, 'zzz')).toEqual([]);
  });
});
