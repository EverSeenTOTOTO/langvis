import { ListMonad } from '@/server/libs/list';

export interface Section {
  name: string;
  content: string;
}

export class Prompt {
  private constructor(private readonly sections: ListMonad<Section>) {}

  static empty(): Prompt {
    return new Prompt(ListMonad.of([]));
  }

  static of(sections: Section[]): Prompt {
    return new Prompt(ListMonad.of(sections));
  }

  concat(other: Prompt): Prompt {
    return new Prompt(this.sections.concat(other.sections));
  }

  map(f: (s: Section) => Section): Prompt {
    return new Prompt(this.sections.map(f));
  }

  chain(f: (sections: readonly Section[]) => Prompt): Prompt {
    return f(this.sections.toArray());
  }

  reduce<T>(f: (acc: T, s: Section) => T, initial: T): T {
    return this.sections.fold(initial, f);
  }

  with(name: string, content: string): Prompt {
    if (this.has(name)) {
      return this.map(s => (s.name === name ? { ...s, content } : s));
    }
    return this.concat(Prompt.of([{ name, content }]));
  }

  without(name: string): Prompt {
    return new Prompt(this.sections.filter(s => s.name !== name));
  }

  insertAfter(after: string, name: string, content: string): Prompt {
    if (!this.has(after)) return this.with(name, content);
    return new Prompt(
      this.sections.flatMap(s =>
        s.name === after
          ? ListMonad.of<Section>([s, { name, content }])
          : ListMonad.of([s]),
      ),
    );
  }

  insertBefore(before: string, name: string, content: string): Prompt {
    if (!this.has(before)) return this.with(name, content);
    return new Prompt(
      this.sections.flatMap(s =>
        s.name === before
          ? ListMonad.of<Section>([{ name, content }, s])
          : ListMonad.of([s]),
      ),
    );
  }

  get(name: string): Section | undefined {
    return this.sections.toArray().find(s => s.name === name);
  }

  has(name: string): boolean {
    return this.sections.toArray().some(s => s.name === name);
  }

  build(): string {
    return this.reduce(
      (acc, s) =>
        acc +
        `## ${s.name}
${s.content}

`,
      '',
    ).trim();
  }
}
