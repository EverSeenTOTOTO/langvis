export interface Section {
  name: string;
  content: string;
}

export class Prompt {
  private constructor(private readonly sections: readonly Section[]) {}

  // ========== Monoid ==========

  /** Create empty Prompt */
  static empty(): Prompt {
    return new Prompt([]);
  }

  /** Concatenate two Prompts */
  concat(other: Prompt): Prompt {
    return new Prompt([...this.sections, ...other.sections]);
  }

  // ========== Functor ==========

  /** Transform each section */
  map(f: (s: Section) => Section): Prompt {
    return new Prompt(this.sections.map(f));
  }

  // ========== Chain ==========

  /** Create new Prompt based on current sections */
  chain(f: (sections: readonly Section[]) => Prompt): Prompt {
    return f(this.sections);
  }

  // ========== Applicative ==========

  /** Create Prompt from sections */
  static of(sections: Section[]): Prompt {
    return new Prompt(sections);
  }

  // ========== Foldable ==========

  /** Reduce sections */
  reduce<T>(f: (acc: T, s: Section) => T, initial: T): T {
    return this.sections.reduce(f, initial);
  }

  // ========== Convenience Methods ==========

  /** Append a section */
  with(name: string, content: string): Prompt {
    return this.concat(Prompt.of([{ name, content }]));
  }

  /** Override an existing section */
  override(name: string, content: string): Prompt {
    return this.map(s => (s.name === name ? { ...s, content } : s));
  }

  /** Remove a section */
  without(name: string): Prompt {
    return new Prompt(this.sections.filter(s => s.name !== name));
  }

  /** Insert after a specified section */
  insertAfter(after: string, name: string, content: string): Prompt {
    const idx = this.sections.findIndex(s => s.name === after);
    if (idx === -1) return this.with(name, content);
    const newSections = [...this.sections];
    newSections.splice(idx + 1, 0, { name, content });
    return new Prompt(newSections);
  }

  /** Insert before a specified section */
  insertBefore(before: string, name: string, content: string): Prompt {
    const idx = this.sections.findIndex(s => s.name === before);
    if (idx === -1) return this.with(name, content);
    const newSections = [...this.sections];
    newSections.splice(idx, 0, { name, content });
    return new Prompt(newSections);
  }

  /** Get a section by name */
  get(name: string): Section | undefined {
    return this.sections.find(s => s.name === name);
  }

  /** Check if a section exists */
  has(name: string): boolean {
    return this.sections.some(s => s.name === name);
  }

  // ========== Build ==========

  /** Build the final prompt string */
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
