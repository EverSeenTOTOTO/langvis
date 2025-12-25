import { defineConfig } from 'vite';
import pkg from '../package.json';
import { fetchEntries, paths } from './vite.common';

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
      input: {
        server: paths.server,
        ...fetchEntries('src/server/core/**/*.ts'),
        ...fetchEntries('src/server/controller/*Controller.ts'),
      },
      output: {
        dir: paths.dist,
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
      },
    },
  },
  ssr: {
    external: Object.keys(pkg.dependencies),
  },
}));
