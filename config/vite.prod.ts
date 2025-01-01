import { defineConfig } from 'vite';
import base from './vite.common';

export default defineConfig(c => {
  const config = base(c);
  return config;
});
