import factory, {
  api,
  type ApiRequest,
  type ApiResponse,
  wrapApi,
} from '@/client/decorator/api';
import { beforeAll, afterAll, expect, it } from 'vitest';
import http from 'node:http';

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
  server.listen(3000);
});

afterAll(() => {
  server?.close();
});

it('wrapApi', async () => {
  class Demo {
    getData(_: ApiRequest, res?: ApiResponse) {
      return res;
    }

    modifyHeader(_: ApiRequest, res?: ApiResponse) {
      return res;
    }

    withParams(_: ApiRequest, res?: ApiResponse) {
      return res;
    }
  }

  const demo = new Demo();
  const apiget = wrapApi(demo.getData.bind(demo), {
    path: 'http://localhost:3000/apiget',
  });

  expect(await apiget({})).toEqual({ data: 'GET' });

  const apiHeader = wrapApi(demo.modifyHeader.bind(demo), {
    path: 'http://localhost:3000/apiheader',
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
    path: 'http://localhost:3000/apierror',
    options: {
      timeout: 1,
    },
  });

  expect(await apiError({})).toEqual({
    status: 0,
    error: new Error(`Request timeout: http://localhost:3000/apierror`),
  });

  const apiParam = wrapApi(demo.withParams.bind(demo), (req: ApiRequest) => ({
    path: `http://localhost:3000/api${req.type}`,
  }));

  expect(await apiParam({ type: 'get' })).toEqual({ data: 'GET' });
});

it('api', async () => {
  class Demo {
    @api({ path: 'http://localhost:3000/apiget' })
    async getData(_: ApiRequest, res?: ApiResponse) {
      return res;
    }

    @api({
      path: 'http://localhost:3000/apiheader',
      options: {
        headers: {
          'x-test': 'test',
        },
      },
    })
    async modifyHeader(_: ApiRequest, res?: ApiResponse) {
      return res;
    }

    @api((req: ApiRequest) => ({
      path: `http://localhost:3000/api${req.type}`,
    }))
    async withParams(_: ApiRequest, res?: ApiResponse) {
      return res;
    }

    @api({
      path: 'http://localhost:3000/apierror',
      options: {
        timeout: 1,
      },
    })
    async error(_: ApiRequest, res?: ApiResponse) {
      return res;
    }
  }

  const demo = factory(new Demo());

  expect(await demo.getData({})).toEqual({ data: 'GET' });
  expect(await demo.modifyHeader({})).toEqual({
    data: 'test',
  });
  expect(await demo.error({})).toEqual({
    status: 0,
    error: new Error(`Request timeout: http://localhost:3000/apierror`),
  });
  expect(await demo.withParams({ type: 'get' })).toEqual({ data: 'GET' });
});
