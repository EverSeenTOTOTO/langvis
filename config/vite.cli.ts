import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from '../package.json';
import { paths } from './vite.common';

// Bundle the CLI (Ink TUI) to dist/cli.js for `bun dist/cli.js` from any cwd
// (launch cwd = workspace; decorators baked, deps external so devtools isn't bundled).

// Prepend the bun shebang so the bundle is directly executable via `langvis`.
function cliShebang() {
  return {
    name: 'cli-shebang',
    generateBundle(_opts: unknown, bundle: Record<string, unknown>) {
      const chunk = bundle['cli.js'] as { type: string; code: string } | undefined;
      if (chunk?.type === 'chunk') chunk.code = '#!/usr/bin/env bun\n' + chunk.code;
    },
  };
}

export default defineConfig(() => ({
  resolve: {
    alias: { '@': paths.src },
  },
  build: {
    ssr: true,
    sourcemap: false,
    emptyOutDir: false,
    rollupOptions: {
      input: { cli: paths.cli },
      output: {
        dir: paths.dist,
        entryFileNames: 'cli.js',
        chunkFileNames: '[name].js',
      },
    },
  },
  ssr: {
    external: [
      ...Object.keys(pkg.dependencies),
      // not a dependency — only referenced inside ink's guarded devtools branch
      'react-devtools-core',
    ],
  },
  plugins: [react(), cliShebang()],
}));
