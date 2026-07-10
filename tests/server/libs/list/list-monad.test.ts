import { describe, it, expect } from 'vitest';
import { ListMonad } from '@/server/libs/list';

describe('ListMonad (monad)', () => {
  it('of 构造并隔离外部数组 mutation', () => {
    const src = [1, 2, 3];
    const list = ListMonad.of(src);
    src.push(4);
    expect(list.toArray()).toEqual([1, 2, 3]);
  });

  it('length / get / toArray', () => {
    const list = ListMonad.of(['a', 'b']);
    expect(list.length).toBe(2);
    expect(list.get(0)).toBe('a');
    expect(list.get(5)).toBeUndefined();
    expect(list.toArray()).toEqual(['a', 'b']);
  });

  it('map 返回新 monad、不改原', () => {
    const list = ListMonad.of([1, 2, 3]);
    const mapped = list.map(x => x * 10);
    expect(mapped.toArray()).toEqual([10, 20, 30]);
    expect(list.toArray()).toEqual([1, 2, 3]); // 原不变
    expect(mapped).not.toBe(list);
  });

  it('filter', () => {
    expect(
      ListMonad.of([1, 2, 3, 4])
        .filter(x => x % 2 === 0)
        .toArray(),
    ).toEqual([2, 4]);
  });

  it('flatMap（bind）摊平', () => {
    const result = ListMonad.of([1, 2, 3]).flatMap(x => ListMonad.of([x, x]));
    expect(result.toArray()).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('fold 离开 monad 归约', () => {
    const sum = ListMonad.of([1, 2, 3, 4]).fold(0, (acc, x) => acc + x);
    expect(sum).toBe(10);
    const indexed = ListMonad.of(['a', 'b']).fold(
      [] as string[],
      (acc, m, i) => [...acc, `${i}:${m}`],
    );
    expect(indexed).toEqual(['0:a', '1:b']);
  });

  it('take / drop / takeLast / dropLast / slice', () => {
    const list = ListMonad.of([1, 2, 3, 4, 5]);
    expect(list.take(2).toArray()).toEqual([1, 2]);
    expect(list.drop(2).toArray()).toEqual([3, 4, 5]);
    expect(list.takeLast(2).toArray()).toEqual([4, 5]);
    expect(list.dropLast(2).toArray()).toEqual([1, 2, 3]);
    expect(list.slice(1, 4).toArray()).toEqual([2, 3, 4]);
  });

  it('takeLast/dropLast 对越界安全', () => {
    expect(ListMonad.of([1, 2]).takeLast(10).toArray()).toEqual([1, 2]);
    expect(ListMonad.of([1, 2]).dropLast(10).toArray()).toEqual([]);
  });

  it('concat / append / prepend / insertAt', () => {
    const a = ListMonad.of([1, 2]);
    expect(a.concat(ListMonad.of([3, 4])).toArray()).toEqual([1, 2, 3, 4]);
    expect(a.append(3, 4).toArray()).toEqual([1, 2, 3, 4]);
    expect(a.prepend(0).toArray()).toEqual([0, 1, 2]);
    expect(a.insertAt(1, 9, 9).toArray()).toEqual([1, 9, 9, 2]);
  });

  it('链式组合：压缩 transform 形态', () => {
    // 模拟压缩：保留 seed 前缀 + 折叠 older + 近期 recent
    const list = ListMonad.of(['seed', 'a1', 'a2', 'a3', 'a4', 'a5']);
    const base = 1;
    const keepRecent = 2;
    const seed = list.take(base);
    const loop = list.drop(base);
    const recent = loop.takeLast(keepRecent);
    const older = loop.dropLast(keepRecent);
    const summary = older.fold('', (acc, m) => `${acc}${m}`);
    const compacted = seed.append(`S:${summary}`).concat(recent);
    expect(compacted.toArray()).toEqual(['seed', 'S:a1a2a3', 'a4', 'a5']);
  });

  it('不可变：所有 op 都返回新实例', () => {
    const list = ListMonad.of([1, 2, 3]);
    const ops = [
      list.map(x => x),
      list.filter(() => true),
      list.take(1),
      list.drop(1),
      list.append(4),
      list.concat(ListMonad.of([4])),
    ];
    for (const o of ops) expect(o).not.toBe(list);
    expect(list.toArray()).toEqual([1, 2, 3]);
  });
});
