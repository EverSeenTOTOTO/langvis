import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import commonConfig from './config/vite.common';

// e2e：boot 真 server（含 DB/SSR/SSE），只在本机开发环境跑（make test-e2e）。
// 与单测分离——make test 不依赖 DB 的约定不变。
export default defineConfig({
  ...commonConfig({ mode: 'test' }),
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', tsx: true, decorators: true },
        transform: {
          legacyDecorator: true,
          // 与 vitest.config 同步：对齐运行时（tsx/esbuild 无 design:paramtypes）
          decoratorMetadata: false,
          react: { runtime: 'automatic' },
        },
      },
    }),
  ],
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globals: true,
    environment: 'node',
    setupFiles: ['reflect-metadata', './tests/setup/eventSource.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 每文件独立 fork 进程（typeorm-transactional 全局注册表按进程隔离），
    // 串行执行避免端口/会话互扰；SSE 等长连接端点在文件内手动 abort。
    pool: 'forks',
    fileParallelism: false,
  },
});
