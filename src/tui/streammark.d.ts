declare module 'streammark' {
  export type Theme = string | Record<string, unknown>;

  export interface MarkdownStreamOptions {
    theme?: Theme;
    output?: { write(s: string): boolean | void };
  }

  export class MarkdownStream {
    constructor(opts?: MarkdownStreamOptions);
    write(chunk: string): void;
    end(): void;
    pipe(readable: AsyncIterable<string>): Promise<void>;
  }

  export function render(md: string, opts?: { theme?: Theme }): string;
  export function print(md: string, opts?: { theme?: Theme }): void;
  export const themes: Record<string, Theme>;
}
