/**
 * MessageList —— 消息列表 monad（Array 风格）。
 *
 * 列表本身是 monad：不可变值，transform 用链式方法（map/filter/flatMap/fold/take/drop/concat…）表达，
 * 每个方法返回新 MessageList。折叠(fold)/退出(toArray)是离开 monad 的出口。
 *
 * 元素类型泛型 T：conv 侧是 Message，loop 侧是 LlmMessage——monad 只提供列表这一层，不规定元素。
 * 两种 transform 都建在它之上：改列表的（map/filter/concat…）与只产副作用的（fold → 存别处）。
 */
export class MessageList<T> {
  private constructor(private readonly items: readonly T[]) {}

  /** 构造（防御拷贝，隔绝外部 mutation）。 */
  static of<T>(items: readonly T[] = []): MessageList<T> {
    return new MessageList([...items]);
  }

  // ── functor / monad ────────────────────────────────────────────────────────

  map<U>(f: (m: T, i: number) => U): MessageList<U> {
    return new MessageList(this.items.map(f));
  }

  filter(p: (m: T, i: number) => boolean): MessageList<T> {
    return new MessageList(this.items.filter(p));
  }

  /** bind：T → MessageList<U>，结果摊平。 */
  flatMap<U>(f: (m: T, i: number) => MessageList<U>): MessageList<U> {
    return new MessageList(this.items.flatMap((m, i) => f(m, i).items));
  }

  /** fold：离开 monad，归约成标量。 */
  fold<U>(seed: U, f: (acc: U, m: T, i: number) => U): U {
    return this.items.reduce(f, seed);
  }

  // ── 切片（压缩 transform 用） ───────────────────────────────────────────────

  slice(start?: number, end?: number): MessageList<T> {
    return new MessageList(this.items.slice(start, end));
  }

  take(n: number): MessageList<T> {
    return new MessageList(this.items.slice(0, n));
  }

  drop(n: number): MessageList<T> {
    return new MessageList(this.items.slice(n));
  }

  takeLast(n: number): MessageList<T> {
    return new MessageList(this.items.slice(-n));
  }

  dropLast(n: number): MessageList<T> {
    return new MessageList(
      this.items.slice(0, Math.max(0, this.items.length - n)),
    );
  }

  // ── 组合 ────────────────────────────────────────────────────────────────────

  concat(other: MessageList<T>): MessageList<T> {
    return new MessageList([...this.items, ...other.items]);
  }

  append(...items: T[]): MessageList<T> {
    return new MessageList([...this.items, ...items]);
  }

  prepend(...items: T[]): MessageList<T> {
    return new MessageList([...items, ...this.items]);
  }

  insertAt(index: number, ...items: T[]): MessageList<T> {
    return new MessageList([
      ...this.items.slice(0, index),
      ...items,
      ...this.items.slice(index),
    ]);
  }

  // ── 退出 / 访问 ──────────────────────────────────────────────────────────────

  /** 离开 monad：返回独立可变拷贝（不暴露内部数组）。 */
  toArray(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }

  get(index: number): T | undefined {
    return this.items[index];
  }
}
