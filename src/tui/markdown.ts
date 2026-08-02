import chalk from 'chalk';
import { render as renderMd } from 'streammark';

// chalk decides color support at module load from process.stdout — level 0 (no
// color) in the browser, where there's no TTY. streammark styles through this
// same chalk singleton, so force truecolor: its chalk.hex(...) then emits SGR.
chalk.level = 3;

type StdoutLike = { columns?: number };
type ProcLike = { stdout?: StdoutLike };

/** Render markdown to styled ANSI via streammark, wrapped to `width` columns.
 * streammark reads `process.stdout.columns` for wrapping (undefined/80 without
 * a real TTY), so shim it for the synchronous render call. Trailing newlines
 * are trimmed so the region measures the right line count. */
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

/** Make streammark's `process.stdout.columns || 80` read `width` for the
 * duration of a render, then restore. Handles: real Node stdout (columns lives
 * on the stream, sometimes as a getter → redefine via defineProperty), a
 * process shim with no stdout (browser polyfill → assign), and no process. */
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
