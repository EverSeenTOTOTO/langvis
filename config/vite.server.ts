import { defineConfig } from 'vite';
import { paths } from './vite.common';
import pkg from '../package.json';

// use vite as cjs bundler
export default defineConfig(({ mode }) => ({
  build: {
    ssr: true,
    sourcemap: mode === 'development',
    emptyOutDir: false,
    rollupOptions: {
      input: paths.server,
      output: {
        dir: paths.dist, // must leave undefined explicitly
        entryFileNames: 'server.js',
      },
    },
  },
  ssr: {
    external: Object.keys(pkg.dependencies),
  },
}));
