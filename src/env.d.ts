/// <reference types="vite/client" />

declare module 'katex/dist/contrib/copy-tex.mjs';

declare interface Window {
  __PREFETCHED_STATE__: any;
}

interface ImportMetaEnv {
  readonly PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
