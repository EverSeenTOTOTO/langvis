/* eslint-disable global-require */
import path from 'path';
import postcssNormalize from 'postcss-normalize';
import postcssFlexbugsFixes from 'postcss-flexbugs-fixes';
import postcssPresetEnv from 'postcss-preset-env';
import react from '@vitejs/plugin-react';

export const paths = {
  src: path.resolve(__dirname, '..', 'src'),
  dist: path.resolve(__dirname, '..', 'dist'),
  template: path.resolve(__dirname, '..', 'index.html'),
  client: path.resolve(__dirname, '..', 'src/client'),
  server: path.resolve(__dirname, '..', 'src/server/index.ts'), // 服务端代码入口
  serverEntry: path.resolve(__dirname, '..', 'src/client/index.server.tsx'), // SSR entry
};

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
  plugins: [react()],
});
