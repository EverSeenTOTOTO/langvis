import bindApi, { api } from '@/server/decorator/api';
import { request, response } from '@/server/decorator/param';
import bodyParser from 'body-parser';
import express, { type Request, type Response } from 'express';

it('api', async () => {
  class Demo {
    @api('/get')
    async getData(@request() req: Request, @response() res: Response) {
      res.json({ data: req.query });
    }

    @api('/post', { method: 'post' })
    async postData(@request() req: Request, @response() res: Response) {
      res.json({ data: req.body });
    }

    @api('/header')
    async getHeader(@request() req: Request, @response() res: Response) {
      res.json({ data: req.headers['x-test'] });
    }

    @api('/error')
    async throwError() {
      throw new Error('error');
    }
  }

  const app = express();

  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  bindApi(new Demo(), '', app);

  await new Promise<void>((resolve, reject) => {
    const port = 3001;
    const server = app.listen(port, async () => {
      try {
        const getData = await fetch(
          `http://localhost:${port}/get?name=hello`,
        ).then(rsp => rsp.json());

        expect(getData).toEqual({ data: { name: 'hello' } });

        const postData = await fetch(`http://localhost:${port}/post`, {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'hello' }),
        }).then(rsp => rsp.json());

        expect(postData).toEqual({ data: { name: 'hello' } });

        const getHeader = await fetch(`http://localhost:${port}/header`, {
          headers: { 'x-test': 'hello' },
        }).then(rsp => rsp.json());

        expect(getHeader).toEqual({ data: 'hello' });

        const error = await fetch(`http://localhost:${port}/error`).then(rsp =>
          rsp.json(),
        );

        expect(error).toEqual({ error: 'error' });

        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
});
