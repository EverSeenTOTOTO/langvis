/**
 * Pure-function tests for the reactions engine (no DOM).
 * Component-level reactivity is covered in SchemaField.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import {
  applyReactions,
  collectFields,
  evalCond,
  type SchemaReaction,
} from '@/client/components/SchemaField/reactions';

type Prop = {
  type?: string;
  title?: string;
  enum?: unknown[];
  required?: boolean;
  visible?: boolean;
};

describe('evalCond', () => {
  it('eq / ne', () => {
    const one = (f: string) => (f === 'a' ? 1 : undefined);
    expect(evalCond({ field: 'a', op: 'eq', value: 1 }, one)).toBe(true);
    expect(evalCond({ field: 'a', op: 'eq', value: 2 }, one)).toBe(false);
    expect(evalCond({ field: 'a', op: 'ne', value: 2 }, one)).toBe(true);
  });

  it('in / nin', () => {
    const get = (f: string) => (f === 'a' ? 'x' : undefined);
    expect(evalCond({ field: 'a', op: 'in', value: ['x', 'y'] }, get)).toBe(
      true,
    );
    expect(evalCond({ field: 'a', op: 'in', value: ['y', 'z'] }, get)).toBe(
      false,
    );
    expect(evalCond({ field: 'a', op: 'nin', value: ['y', 'z'] }, get)).toBe(
      true,
    );
  });

  it('notEmpty', () => {
    expect(evalCond({ field: 'a', op: 'notEmpty' }, () => 'x')).toBe(true);
    expect(evalCond({ field: 'a', op: 'notEmpty' }, () => '')).toBe(false);
    expect(evalCond({ field: 'a', op: 'notEmpty' }, () => undefined)).toBe(
      false,
    );
    expect(evalCond({ field: 'a', op: 'notEmpty' }, () => null)).toBe(false);
  });

  it('matches', () => {
    expect(
      evalCond({ field: 'a', op: 'matches', pattern: '^gpt' }, () => 'gpt-4'),
    ).toBe(true);
    expect(
      evalCond({ field: 'a', op: 'matches', pattern: '^gpt' }, () => 'claude'),
    ).toBe(false);
    // non-string value never matches
    expect(
      evalCond({ field: 'a', op: 'matches', pattern: 'x' }, () => 123),
    ).toBe(false);
  });

  it('and / or / not compose', () => {
    const get = (f: string) => (f === 'a' ? 1 : f === 'b' ? 2 : undefined);
    expect(
      evalCond(
        {
          and: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 2 },
          ],
        },
        get,
      ),
    ).toBe(true);
    expect(
      evalCond(
        {
          and: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 3 },
          ],
        },
        get,
      ),
    ).toBe(false);
    expect(
      evalCond(
        {
          or: [
            { field: 'a', op: 'eq', value: 9 },
            { field: 'b', op: 'eq', value: 2 },
          ],
        },
        get,
      ),
    ).toBe(true);
    expect(evalCond({ not: { field: 'a', op: 'eq', value: 9 } }, get)).toBe(
      true,
    );
  });

  it('treats undefined peer sensibly', () => {
    expect(
      evalCond(
        { field: 'missing', op: 'eq', value: undefined },
        () => undefined,
      ),
    ).toBe(true);
    expect(
      evalCond({ field: 'missing', op: 'ne', value: 'on' }, () => undefined),
    ).toBe(true);
  });
});

describe('collectFields', () => {
  it('collects leaf fields, recursing through and/or/not, deduped', () => {
    const reactions: SchemaReaction[] = [
      { when: { field: 'a', op: 'eq', value: 1 }, set: {} },
      {
        when: {
          and: [
            { field: 'b', op: 'notEmpty' },
            {
              or: [
                { field: 'c', op: 'eq', value: 1 },
                { not: { field: 'a', op: 'eq', value: 2 } },
              ],
            },
          ],
        },
        set: {},
      },
    ];
    expect(collectFields(reactions).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for undefined/empty', () => {
    expect(collectFields(undefined)).toEqual([]);
    expect(collectFields([])).toEqual([]);
  });
});

describe('applyReactions', () => {
  const base: Prop = { type: 'string', title: 'T', enum: ['x', 'y'] };

  it('returns a fresh shallow copy when there are no reactions', () => {
    const out = applyReactions(base, undefined, () => undefined);
    expect(out).not.toBe(base);
    expect(out).toEqual(base);
  });

  it('applies matching set and leaves the rest untouched', () => {
    const out = applyReactions<Prop>(
      base,
      [{ when: { field: 'a', op: 'eq', value: 1 }, set: { required: true } }],
      (f: string) => (f === 'a' ? 1 : undefined),
    );
    expect(out.required).toBe(true);
    expect(out.enum).toEqual(['x', 'y']);
  });

  it('last matching reaction wins', () => {
    const out = applyReactions<Prop>(
      base,
      [
        { when: { field: 'a', op: 'notEmpty' }, set: { title: 'One' } },
        { when: { field: 'a', op: 'notEmpty' }, set: { title: 'Two' } },
      ],
      () => 'x',
    );
    expect(out.title).toBe('Two');
  });

  it('never mutates the input prop', () => {
    const prop: Prop = { type: 'string', title: 'T' };
    applyReactions<Prop>(
      prop,
      [{ when: { field: 'a', op: 'notEmpty' }, set: { title: 'Changed' } }],
      () => 'x',
    );
    expect(prop.title).toBe('T');
  });

  it('skips reactions whose when is false', () => {
    const out = applyReactions<Prop>(
      base,
      [{ when: { field: 'a', op: 'eq', value: 1 }, set: { required: true } }],
      () => 2, // a !== 1
    );
    expect(out.required).toBeUndefined();
  });

  it('overrides enum via set', () => {
    const out = applyReactions<Prop>(
      base,
      [{ when: { field: 'a', op: 'eq', value: 1 }, set: { enum: ['only'] } }],
      () => 1,
    );
    expect(out.enum).toEqual(['only']);
  });
});
