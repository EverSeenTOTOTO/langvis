/**
 * 并发汇流多个 AsyncGenerator：任一产出即转发，全部结束后收尾。单条流抛错不影响其它
 * （allSettled 语义）。事件按到达顺序交错转发，保证消费方近实时看到各流进展。
 */
export async function* mergeGenerators<T>(
  gens: readonly AsyncGenerator<T>[],
): AsyncGenerator<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let active = gens.length;

  const tasks = gens.map(async gen => {
    try {
      for await (const item of gen) {
        queue.push(item);
        wake?.();
        wake = null;
      }
    } catch {
      // 单条流失败不击垮汇流——allSettled。
    } finally {
      active -= 1;
      wake?.();
      wake = null;
    }
  });

  while (active > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    }
    while (queue.length > 0) yield queue.shift() as T;
  }

  await Promise.allSettled(tasks);
}
