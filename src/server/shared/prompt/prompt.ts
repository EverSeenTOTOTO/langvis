export interface Section {
  name: string;
  content: string;
}

export class Prompt {
  private constructor(private readonly sections: readonly Section[]) {}

  static empty(): Prompt {
    return new Prompt([]);
  }

  static of(sections: readonly Section[]): Prompt {
    return new Prompt([...sections]);
  }

  concat(other: Prompt): Prompt {
    return new Prompt([...this.sections, ...other.sections]);
  }

  map(f: (s: Section) => Section): Prompt {
    return new Prompt(this.sections.map(f));
  }

  chain(f: (sections: readonly Section[]) => Prompt): Prompt {
    return f(this.sections);
  }

  reduce<T>(f: (acc: T, s: Section) => T, initial: T): T {
    return this.sections.reduce(f, initial);
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
        s.name === after ? [s, { name, content }] : [s],
      ),
    );
  }

  insertBefore(before: string, name: string, content: string): Prompt {
    if (!this.has(before)) return this.with(name, content);
    return new Prompt(
      this.sections.flatMap(s =>
        s.name === before ? [{ name, content }, s] : [s],
      ),
    );
  }

  get(name: string): Section | undefined {
    return this.sections.find(s => s.name === name);
  }

  has(name: string): boolean {
    return this.sections.some(s => s.name === name);
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
