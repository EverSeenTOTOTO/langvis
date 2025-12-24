import path from 'path';
import { fileURLToPath } from 'url';
import type { Request } from 'express';

export const __filename = () => fileURLToPath(import.meta.url);
export const __dirname = () => path.dirname(__filename());

export const isDev = process.env.NODE_ENV === 'development';
export const isProd = process.env.NODE_ENV === 'production';

export const getSessionHeaders = (req: Request) => {
  const headers = new Headers();

  // Copy the headers from the request
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.append(key, value[0]);
    } else {
      headers.append(key, value!);
    }
  }

  return headers;
};
