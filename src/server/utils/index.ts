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

export async function runTool<T = unknown>(
  toolGenerator: AsyncGenerator<ToolEvent, T, void>,
): Promise<T> {
  for await (const event of toolGenerator) {
    if (event.type === 'result') {
      return event.output as T;
    }
  }

  throw new Error('Tool did not return a result event');
}
