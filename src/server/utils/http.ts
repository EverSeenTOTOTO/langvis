import type { Request } from 'express';

export const getSessionHeaders = (req: Request) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.append(key, value[0]);
    } else {
      headers.append(key, value!);
    }
  }

  return headers;
};
