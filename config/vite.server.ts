import { defineConfig } from 'vite';
import { paths } from './vite.common';
import pkg from '../package.json';

// use vite as cjs bundler
export default defineConfig(() => ({
  resolve: {
    alias: {
      '@': paths.src,
    },
  },
  build: {
    ssr: true,
    sourcemap: false,
    emptyOutDir: false,
    rollupOptions: {
      input: paths.server,
      output: {
        dir: paths.dist,
        entryFileNames: 'server.js',
      },
    },
  },
  ssr: {
    external: Object.keys(pkg.dependencies),
  },
}));
