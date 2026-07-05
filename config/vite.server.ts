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
        ...fetchEntries('src/server/controller/*Controller.ts'),
        // 工具靠运行时 globby + 动态 import 发现（见 ToolService.discoverTools），
        // 不被任何入口静态引用，须显式作为 entry 才会被 emit 到 dist。
        ...fetchEntries(
          'src/server/modules/agent/implementations/tools/*/index.ts',
        ),
        ...fetchEntries(
          'src/server/modules/agent/implementations/tools/*/config.ts',
        ),
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
