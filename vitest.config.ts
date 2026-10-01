import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import commonConfig from './config/vite.common';

export default defineConfig({
  ...commonConfig({ mode: 'test' }),
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: 'typescript',
          tsx: true,
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          // 与运行时对齐：tsx(esbuild)/vite 产不出 design:paramtypes，
          // 开着会让测试走 prod 不存在的类型推断分支（@body/@query DTO 推断）。
          decoratorMetadata: false,
          react: {
            runtime: 'automatic',
          },
        },
      },
    }),
  ],
  test: {
    coverage: {
      include: ['src/**'],
    },
    // tests/client: dead React app, compiles JSX as React via swc.
    // tests/e2e: boots real server + DB — run via `make test-e2e` only.
    exclude: [
      'tests/client/**',
      'tests/e2e/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
    globals: true,
    environment: 'node',
    setupFiles: ['reflect-metadata', './tests/setup/eventSource.ts'],
  },
});
