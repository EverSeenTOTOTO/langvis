import factory, { api, ApiRequest, wrapApi } from '@/client/decorator/api';
import http from 'node:http';

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

    if (/apiquery/.test(req.url!)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: req.url!.split('?')[1] }));
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
    res.end(JSON.stringify({}));
  });
  server.listen(port);
});

afterAll(() => {
  server?.close();
});

it('wrapApi', async () => {
  class Demo {
    getData(_: any, req?: ApiRequest) {
      return req!.send();
    }

    postData(_: any, req?: ApiRequest) {
      return req!.send();
    }

    modifyHeader(_: any, req?: ApiRequest) {
      return req!.send();
    }

    withQuery(_: any, req?: ApiRequest) {
      return req!.send();
    }

    withParams(_: any, req?: ApiRequest) {
      return req!.send();
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

  const apiQuery = wrapApi(demo.withQuery.bind(demo), {
    config: (req: { query: string }) =>
      `http://localhost:${port}/apiquery?test=${req.query}`,
  });

  expect(await apiQuery({ query: '42' })).toEqual({
    data: 'test=42',
  });

  const apiError = wrapApi(demo.modifyHeader.bind(demo), {
    config: {
      path: `http://localhost:${port}/apitimeout`,
      options: {
        timeout: 1,
      },
    },
  });

  await expect(apiError({})).rejects.toThrow(
    `Response error: http://localhost:${port}/apitimeout 404`,
  );

  const apiParam = wrapApi(demo.withParams.bind(demo), {
    config: `http://localhost:${port}/api/:type`,
  });

  expect(await apiParam({ type: 'get' })).toEqual({ data: 'GET' });
});

it('api', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiget`)
    getData(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apipost`, {
      method: 'post',
    })
    postData(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api({
      path: `http://localhost:${port}/apiheader`,
      options: {
        headers: {
          'x-test': 'test',
        },
      },
    })
    modifyHeader(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/api/:type`)
    withParams(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api({
      path: `http://localhost:${port}/apitimeout`,
      options: {
        timeout: 1,
      },
    })
    error(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(() => {
      throw new Error('test');
    })
    error2(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apierror`)
    error3(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apicookie`)
    cookie(_: any, req?: ApiRequest) {
      return req!.send();
    }
  }

  const demo = factory(new Demo());

  expect(await demo.getData({})).toEqual({ data: 'GET' });
  expect(await demo.postData('POST')).toEqual('POST');
  expect(await demo.modifyHeader({})).toEqual({
    data: 'test',
  });
  await expect(demo.error({})).rejects.toThrow(
    `Response error: http://localhost:${port}/apitimeout 404`,
  );
  await expect(demo.error2({})).rejects.toThrow('test');
  await expect(demo.error3({})).rejects.toThrow('test');
  expect(await demo.withParams({ type: 'get' })).toEqual({ data: 'GET' });
  expect(await demo.cookie({})).toEqual({
    cookie:
      'session=eyJpZCI6Ijc3MWY5ZDdjLTEwNzUtNDljNC05YzZlLWJiNDI0ZDQ3MThkNSJ9',
  });
});
