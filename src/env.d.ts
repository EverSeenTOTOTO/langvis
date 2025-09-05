/// <reference types="vite/client" />

declare interface Window {
  __PREFETCHED_STATE__: any;
}

interface ImportMetaEnv {
  readonly PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
