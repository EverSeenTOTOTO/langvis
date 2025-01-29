import 'reflect-metadata';

import bindApi, { api } from '@/server/decorator/api';
import bodyParser from 'body-parser';
import express, { type Request, type Response } from 'express';
import { expect, it } from 'vitest';

it('api', async () => {
  class Demo {
    @api('/get')
    async getData(req: Request, res: Response) {
      res.json({ data: req.query });
    }

    @api('/post', { method: 'post' })
    async postData(req: Request, res: Response) {
      res.json({ data: req.body });
    }

    @api('/header')
    async getHeader(req: Request, res: Response) {
      res.json({ data: req.headers['x-test'] });
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
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
});
