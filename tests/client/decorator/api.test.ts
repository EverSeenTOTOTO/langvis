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

    // Handle /api/:type path for testing path params with extra query
    const pathMatch = req.url!.match(/^\/api\/([^/?]+)/);
    if (pathMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: req.url!.split('?')[1] || pathMatch[1] }));
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

    // Handle PUT/PATCH requests
    if (['PUT', 'PATCH'].includes(req.method!)) {
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

    if (/apiformdata/.test(req.url!)) {
      const contentType = req.headers['content-type'] as string;
      const isFormData = contentType?.includes('multipart/form-data');
      let body = '';

      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            isFormData,
            hasFile: body.includes('Content-Disposition'),
            bodyPreview: body.slice(0, 200),
          }),
        );
      });
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
    config: {
      path: `http://localhost:${port}/apiheader`,
      options: {
        headers: {
          'x-test': 'test',
        },
      },
    },
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
  await expect(demo.error3({})).rejects.toThrow('test');
  expect(await demo.withParams({ type: 'get' })).toEqual({ data: 'GET' });
  expect(await demo.cookie({})).toEqual({
    cookie:
      'session=eyJpZCI6Ijc3MWY5ZDdjLTEwNzUtNDljNC05YzZlLWJiNDI0ZDQ3MThkNSJ9',
  });
});

it('api with FormData auto-detection', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiformdata`, { method: 'post' })
    uploadWithFile(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apipost`, { method: 'post' })
    uploadWithoutFile(_: any, req?: ApiRequest) {
      return req!.send();
    }
  }

  const demo = factory(new Demo());

  // Test with File - should use FormData
  const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
  const result1 = await demo.uploadWithFile({ file, userId: '123' });

  expect(result1.isFormData).toBe(true);
  expect(result1.hasFile).toBe(true);

  // Test without File - should use JSON
  const result2 = await demo.uploadWithoutFile({ name: 'hello' });

  expect(result2).toEqual({ name: 'hello' });
});

it('api with extra params as query string', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiquery`)
    withExtraParams(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/api/:type`)
    withPathAndQuery(_: any, req?: ApiRequest) {
      return req!.send();
    }
  }

  const demo = factory(new Demo());

  // Extra params should be appended as query string
  const result1 = await demo.withExtraParams({
    keyword: 'test',
    category: 'tech',
    page: 1,
    pageSize: 10,
  });

  expect(result1.data).toContain('keyword=test');
  expect(result1.data).toContain('category=tech');
  expect(result1.data).toContain('page=1');
  expect(result1.data).toContain('pageSize=10');

  // Path params should not be in query string, extra params should
  const result2 = await demo.withPathAndQuery({
    type: 'query',
    keyword: 'search',
    page: 2,
  });

  expect(result2.data).toContain('keyword=search');
  expect(result2.data).toContain('page=2');
  expect(result2.data).not.toContain('type=query');

  // Undefined values should not be in query string
  const result3 = await demo.withExtraParams({
    keyword: 'test',
    category: undefined,
    page: 1,
    pageSize: undefined,
  });

  expect(result3.data).toContain('keyword=test');
  expect(result3.data).toContain('page=1');
  expect(result3.data).not.toContain('category');
  expect(result3.data).not.toContain('pageSize');
});

it('api with POST should not append query string', async () => {
  class Demo {
    @api(`http://localhost:${port}/apipost`, { method: 'post' })
    postWithExtraParams(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apipost`, { method: 'put' })
    putWithExtraParams(_: any, req?: ApiRequest) {
      return req!.send();
    }
  }

  const demo = factory(new Demo());

  // POST with extra params - should be in body, not query string
  const result1 = await demo.postWithExtraParams({
    name: 'test',
    value: 123,
  });

  // Body should contain the params
  expect(result1).toEqual({ name: 'test', value: 123 });

  // PUT - params should be in body, not query string
  const result2 = await demo.putWithExtraParams({
    name: 'updated',
    count: 5,
  });

  expect(result2).toEqual({ name: 'updated', count: 5 });
});

it('api with null/undefined params and existingQuery merging', async () => {
  class Demo {
    @api(`http://localhost:${port}/apiquery`)
    withNullParams(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/apiquery?existing=1`)
    withExistingQuery(_: any, req?: ApiRequest) {
      return req!.send();
    }

    @api(`http://localhost:${port}/api/:type?sort=desc`)
    withPathAndExistingQuery(_: any, req?: ApiRequest) {
      return req!.send();
    }
  }

  const demo = factory(new Demo());

  // null params should not throw
  const result1 = await demo.withNullParams(null as any);
  expect(result1.data).toBeUndefined();

  // undefined params should not throw
  const result2 = await demo.withNullParams(undefined as any);
  expect(result2.data).toBeUndefined();

  // existingQuery should merge with extra params
  const result3 = await demo.withExistingQuery({ page: 1, size: 10 });
  expect(result3.data).toContain('existing=1');
  expect(result3.data).toContain('page=1');
  expect(result3.data).toContain('size=10');

  // path params + existingQuery + extra params should all work together
  const result4 = await demo.withPathAndExistingQuery({
    type: 'items',
    filter: 'active',
  });
  expect(result4.data).toContain('sort=desc');
  expect(result4.data).toContain('filter=active');
  expect(result4.data).not.toContain('type=items'); // type is path param
});
