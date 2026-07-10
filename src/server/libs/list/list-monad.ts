export class ListMonad<T> {
  private constructor(private readonly items: readonly T[]) {}

  static of<T>(items: readonly T[] = []): ListMonad<T> {
    return new ListMonad([...items]);
  }

  map<U>(f: (m: T, i: number) => U): ListMonad<U> {
    return new ListMonad(this.items.map(f));
  }

  filter(p: (m: T, i: number) => boolean): ListMonad<T> {
    return new ListMonad(this.items.filter(p));
  }

  flatMap<U>(f: (m: T, i: number) => ListMonad<U>): ListMonad<U> {
    return new ListMonad(this.items.flatMap((m, i) => f(m, i).items));
  }

  fold<U>(seed: U, f: (acc: U, m: T, i: number) => U): U {
    return this.items.reduce(f, seed);
  }

  slice(start?: number, end?: number): ListMonad<T> {
    return new ListMonad(this.items.slice(start, end));
  }

  take(n: number): ListMonad<T> {
    return new ListMonad(this.items.slice(0, n));
  }

  drop(n: number): ListMonad<T> {
    return new ListMonad(this.items.slice(n));
  }

  takeLast(n: number): ListMonad<T> {
    return new ListMonad(this.items.slice(-n));
  }

  dropLast(n: number): ListMonad<T> {
    return new ListMonad(
      this.items.slice(0, Math.max(0, this.items.length - n)),
    );
  }

  concat(other: ListMonad<T>): ListMonad<T> {
    return new ListMonad([...this.items, ...other.items]);
  }

  append(...items: T[]): ListMonad<T> {
    return new ListMonad([...this.items, ...items]);
  }

  prepend(...items: T[]): ListMonad<T> {
    return new ListMonad([...items, ...this.items]);
  }

  insertAt(index: number, ...items: T[]): ListMonad<T> {
    return new ListMonad([
      ...this.items.slice(0, index),
      ...items,
      ...this.items.slice(index),
    ]);
  }

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
