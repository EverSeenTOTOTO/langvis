import { ToolEvent } from '@/shared/types';
import type { Request } from 'express';

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

export async function runTool<T>(
  toolGenerator: AsyncGenerator<ToolEvent<T>, T, void>,
): Promise<T> {
  let result: T | undefined;
  for await (const event of toolGenerator) {
    if (event.type === 'result') {
      result = event.result;
    }
  }
  return result!;
}
