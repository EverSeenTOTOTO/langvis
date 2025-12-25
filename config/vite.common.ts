import react from '@vitejs/plugin-react';
import { globbySync } from 'globby';
import path from 'path';
import postcssFlexbugsFixes from 'postcss-flexbugs-fixes';
import postcssNormalize from 'postcss-normalize';
import postcssPresetEnv from 'postcss-preset-env';

export const paths = {
  src: path.resolve(__dirname, '..', 'src'),
  dist: path.resolve(__dirname, '..', 'dist'),
  server: path.resolve(__dirname, '..', 'src/server/index.ts'), // 服务端代码入口
  serverEntry: path.resolve(__dirname, '..', 'src/client/index.server.tsx'), // SSR entry
};

export const fetchEntries = (pattern: string) =>
  Object.fromEntries(
    globbySync(pattern).map(file => [
      file.replace('src/', '').replace('.ts', ''),
      file,
    ]),
  );

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
  plugins: [react()],
});
