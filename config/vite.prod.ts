import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import base from './vite.common';

export default defineConfig(c => {
  const config = base(c);
  config.plugins?.push([
    visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ]);

  return {
    ...config,
    build: {
      ...config.build,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('node_modules')) {
              if (id.includes('react-syntax-highlighter')) {
                return 'syntax-highlighter';
              }
              if (id.includes('mathjax-full')) {
                return 'mathjax';
              }
              if (
                id.includes('react-markdown') ||
                id.includes('remark-') ||
                id.includes('rehype-') ||
                id.includes('unist-') ||
                id.includes('micromark') ||
                id.includes('mdast')
              ) {
                return 'markdown';
              }
            }
          },
        },
      },
    },
  };
});
