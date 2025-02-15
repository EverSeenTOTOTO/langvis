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
  server = http.createServer(async (req, res) => {
    if (/api\/?get/.test(req.url!)) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie':
          'session=eyJpZCI6Ijc3MWY5ZDdjLTEwNzUtNDljNC05YzZlLWJiNDI0ZDQ3MThkNSJ9',
      });
      res.end(JSON.stringify({ data: 'GET' }));
      return;
    }

    if (/apipost/.test(req.url!)) {
      let data = '';

      req.on('data', chunk => {
        data += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
      return;
    }

    if (/apiheader/.test(req.url!)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: req.headers['x-test'] }));
      return;
    }

    if (/apierror/.test(req.url!)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'test' }));
      return;
    }

    if (/apicookie/.test(req.url!)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cookie: req.headers.cookie }));
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    res.writeHead(404);
    res.end({});
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

    postData(_: any, res?: ApiResponse) {
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
  const apiget = wrapApi(demo.getData.bind(demo), {
    config: `http://localhost:${port}/apiget`,
  });

  expect(await apiget({})).toEqual({ data: 'GET' });

  const apiPost = wrapApi(demo.postData.bind(demo), {
    config: `http://localhost:${port}/apipost`,
    options: {
      method: 'post',
    },
  });

  expect(await apiPost('POST')).toEqual('POST');

  const apiHeader = wrapApi(demo.modifyHeader.bind(demo), {
    config: () => ({
      path: `http://localhost:${port}/apiheader`,
      options: {
        headers: {
          'x-test': 'test',
        },
      },
    }),
  });

  expect(await apiHeader({})).toEqual({
    data: 'test',
  });

  const apiError = wrapApi(demo.modifyHeader.bind(demo), {
    config: {
      path: `http://localhost:${port}/apitimeout`,
      options: {
        timeout: 1,
      },
    },
  });

  expect(await apiError({})).toEqual({
    error: `Request timeout: http://localhost:${port}/apitimeout`,
  });

  const apiParam = wrapApi(demo.withParams.bind(demo), {
    config: `http://localhost:${port}/api/:type`,
  });

  expect(await apiParam({ type: 'get' })).toEqual({ data: 'GET' });
});

it('api', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiget`)
    async getData(_: any, res?: ApiResponse) {
      return res;
    }

    @api(`http://localhost:${port}/apipost`, {
      method: 'post',
    })
    async postData(_: any, res?: ApiResponse) {
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

    @api(`http://localhost:${port}/api/:type`)
    async withParams(_: any, res?: ApiResponse) {
      return res;
    }

    @api({
      path: `http://localhost:${port}/apitimeout`,
      options: {
        timeout: 1,
      },
    })
    async error(_: void, res?: ApiResponse) {
      return res;
    }

    @api(() => {
      throw new Error('test');
    })
    async error2(_: void, res?: ApiResponse) {
      return res;
    }

    @api(`http://localhost:${port}/apierror`)
    async error3(_: void, res?: ApiResponse) {
      return res;
    }

    @api(`http://localhost:${port}/apicookie`)
    async cookie(_: void, res?: ApiResponse) {
      return res;
    }
  }

  const demo = factory(new Demo());

  expect(await demo.getData({})).toEqual({ data: 'GET' });
  expect(await demo.postData('POST')).toEqual('POST');
  expect(await demo.modifyHeader({})).toEqual({
    data: 'test',
  });
  expect(await demo.error()).toEqual({
    error: `Request timeout: http://localhost:${port}/apitimeout`,
  });
  expect(await demo.error2()).toEqual({
    error: 'test',
  });
  expect(await demo.error3()).toEqual({
    error: 'test',
  });
  expect(await demo.withParams({ type: 'get' })).toEqual({ data: 'GET' });
  expect(await demo.cookie()).toEqual({
    cookie:
      'session=eyJpZCI6Ijc3MWY5ZDdjLTEwNzUtNDljNC05YzZlLWJiNDI0ZDQ3MThkNSJ9',
  });
});
