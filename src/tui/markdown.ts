import chalk from 'chalk';
import { render as renderMd } from 'streammark';

// chalk decides color support at module load (level 0 in the browser); streammark
// uses the same chalk singleton, so force truecolor so its hex(...) emits SGR.
chalk.level = 3;

type StdoutLike = { columns?: number };
type ProcLike = { stdout?: StdoutLike };

// Render markdown to styled ANSI via streammark, wrapped to `width`. streammark
// reads process.stdout.columns, so shim it; trailing newlines are trimmed.
export function renderMarkdown(
  md: string,
  width: number,
  theme = 'dark',
): string {
  const restore = shimColumns(width);
  try {
    return renderMd(md, { theme }).replace(/\n+$/, '');
  } finally {
    restore();
  }
}

// Make streammark's process.stdout.columns read `width` for a render, then
// restore. Handles real Node stdout, a shim with no stdout, and no process.
function shimColumns(width: number): () => void {
  const g = globalThis as unknown as { process?: ProcLike };
  const proc = g.process;

  if (proc?.stdout) {
    const stdout = proc.stdout;
    const hadDesc = Object.getOwnPropertyDescriptor(stdout, 'columns');
    Object.defineProperty(stdout, 'columns', {
      value: width,
      configurable: true,
      writable: true,
    });
    return () => {
      if (hadDesc) Object.defineProperty(stdout, 'columns', hadDesc);
      else delete stdout.columns;
    };
  }

  if (proc) {
    const prev = proc.stdout;
    proc.stdout = { columns: width };
    return () => {
      proc.stdout = prev;
    };
  }

  g.process = { stdout: { columns: width } };
  return () => {
    delete g.process;
  };
}
