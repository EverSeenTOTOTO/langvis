import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, Plugin } from 'vite';
import base from './vite.common';

/**
 * Plugin to replace fetch-cookie dynamic import with stub in client build.
 * This prevents tough-cookie/tldts from being bundled into client.
 */
function replaceFetchCookie(): Plugin {
  return {
    name: 'replace-fetch-cookie',
    enforce: 'pre',
    transform(code, id) {
      // Only transform the api.ts file during client build (not SSR)
      if (id.includes('decorator/api.ts') && !this.meta.watchMode) {
        // Replace dynamic import of fetch-cookie with stub
        return code.replace(
          /const fetchCookie = \(await import\('fetch-cookie'\)\)\.default;/g,
          'throw new Error("fetch-cookie should not be called on client");',
        );
      }
    },
  };
}

export default defineConfig(c => {
  const config = base(c);
  config.plugins?.push(
    replaceFetchCookie(),
    visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  );

  return {
    ...config,
    build: {
      ...config.build,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('node_modules')) {
              if (
                id.includes('katex') ||
                id.includes('prism-react-renderer') ||
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
