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
          decoratorMetadata: true,
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
    globals: true,
    environment: 'node',
    setupFiles: ['reflect-metadata', './tests/setup/eventSource.ts'],
  },
});
