import react from '@vitejs/plugin-react';
import { globbySync } from 'globby';
import path from 'path';
import postcssFlexbugsFixes from 'postcss-flexbugs-fixes';
import postcssNormalize from 'postcss-normalize';
import postcssPresetEnv from 'postcss-preset-env';
import type { Plugin } from 'vite';

export const paths = {
  src: path.resolve(__dirname, '..', 'src'),
  dist: path.resolve(__dirname, '..', 'dist'),
  server: path.resolve(__dirname, '..', 'src/server/index.ts'),
  serverEntry: path.resolve(__dirname, '..', 'src/client/index.server.tsx'),
};

export const fetchEntries = (pattern: string) =>
  Object.fromEntries(
    globbySync(pattern).map(file => [
      file.replace('src/', '').replace('.ts', ''),
      file,
    ]),
  );

function katexFontPreload(): Plugin {
  return {
    name: 'katex-font-preload',
    transformIndexHtml(html, { bundle }) {
      if (!bundle) return html;

      const katexFonts = Object.keys(bundle).filter(
        key => key.includes('KaTeX') && key.endsWith('.woff2'),
      );

      if (katexFonts.length === 0) return html;

      const preloadLinks = katexFonts
        .map(
          font =>
            `<link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />`,
        )
        .join('\n    ');

      return html.replace(
        '<!--app-style-->',
        `<!--app-style-->\n    ${preloadLinks}`,
      );
    },
  };
}

export default ({ mode }) => ({
  build: {
    sourcemap: true,
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      '@': paths.src,
    },
  },
  css: {
    postcss: {
      plugins: [
        postcssFlexbugsFixes,
        postcssPresetEnv({
          autoprefixer: {
            flexbox: 'no-2009',
          },
          stage: 3,
        }),
        postcssNormalize(),
      ],
    },
    devSourcemap: mode === 'development',
  },
  ssr: {
    noExternal: ['tsyringe', 'react-use'],
  },
  plugins: [react(), katexFontPreload()],
});
