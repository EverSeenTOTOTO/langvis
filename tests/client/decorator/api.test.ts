import 'reflect-metadata';

import factory, {
  api,
  type ApiResponse,
  wrapApi,
} from '@/client/decorator/api';
import http from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';

const port = 3002;
let server: http.Server;

beforeAll(() => {
  server = http.createServer((req, res) => {
    if (/apiget/.test(req.url!)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: 'GET' }));
      return;
    }

    if (/apiheader/.test(req.url!)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: req.headers['x-test'] }));
      return;
    }
  });
  server.listen(port);
});

afterAll(() => {
  server?.close();
});

it('wrapApi', async () => {
  class Demo {
    getData(_: any, res?: ApiResponse) {
      return res;
    }

    modifyHeader(_: any, res?: ApiResponse) {
      return res;
    }

    withParams(_: any, res?: ApiResponse) {
      return res;
    }
  }

  const demo = new Demo();
  const apiget = wrapApi(
    demo.getData.bind(demo),
    `http://localhost:${port}/apiget`,
  );

  expect(await apiget({})).toEqual({ data: 'GET' });

  const apiHeader = wrapApi(demo.modifyHeader.bind(demo), {
    path: `http://localhost:${port}/apiheader`,
    options: {
      headers: {
        'x-test': 'test',
      },
    },
  });

  expect(await apiHeader({})).toEqual({
    data: 'test',
  });

  const apiError = wrapApi(demo.modifyHeader.bind(demo), {
    path: `http://localhost:${port}/apierror`,
    options: {
      timeout: 1,
    },
  });

  expect(await apiError({})).toEqual({
    error: `Request timeout: http://localhost:${port}/apierror`,
  });

  const apiParam = wrapApi(
    demo.withParams.bind(demo),
    (req: any) => `http://localhost:${port}/api${req.type}`,
  );

  expect(await apiParam({ type: 'get' })).toEqual({ data: 'GET' });
});

it('api', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiget`)
    async getData(_: any, res?: ApiResponse) {
      return res;
    }

    @api({
      path: `http://localhost:${port}/apiheader`,
      options: {
        headers: {
          'x-test': 'test',
        },
      },
    })
    async modifyHeader(_: any, res?: ApiResponse) {
      return res;
    }

    @api((req: { type: string }) => `http://localhost:${port}/api${req.type}`)
    async withParams(_: any, res?: ApiResponse) {
      return res;
    }

    @api({
      path: `http://localhost:${port}/apierror`,
      options: {
        timeout: 1,
      },
    })
    async error(_: void, res?: ApiResponse) {
      return res;
    }
  }

  const demo = factory(new Demo());

  expect(await demo.getData({})).toEqual({ data: 'GET' });
  expect(await demo.modifyHeader({})).toEqual({
    data: 'test',
  });
  expect(await demo.error()).toEqual({
    error: `Request timeout: http://localhost:${port}/apierror`,
  });
  expect(await demo.withParams({ type: 'get' })).toEqual({ data: 'GET' });
});
