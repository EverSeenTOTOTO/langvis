import { defineConfig } from 'vitest/config';
import commonConfig from './config/vite.common';

export default defineConfig({
  ...commonConfig({ mode: 'test' }),
  test: {
    coverage: {
      include: ['src/**'],
    },
    globals: true,
    environment: 'node',
    setupFiles: 'reflect-metadata',
  },
});
