import { api } from '@/server/decorator/api';
import bindController, { controller } from '@/server/decorator/controller';
import { inject } from '@/server/decorator/inject';
import bodyParser from 'body-parser';
import express, { type Request, type Response } from 'express';
import { expect, it } from 'vitest';

it('controller', async () => {
  @controller('/ns')
  class Demo {
    @inject()
    foo?: string;

    @inject('baz')
    bar?: string;

    @api('/get')
    async getData(req: Request, res: Response) {
      res.json({ data: req.query, foo: this.foo, bar: this.bar });
    }
  }

  const app = express();

  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  bindController(Demo, app, {
    foo: 'hello',
    baz: 'world',
  });

  await new Promise<void>((resolve, reject) => {
    const port = 3003;
    const server = app.listen(port, async () => {
      try {
        const getData = await fetch(
          `http://localhost:${port}/ns/get?name=hello`,
        ).then(rsp => rsp.json());

        expect(getData).toEqual({
          foo: 'hello',
          bar: 'world',
          data: { name: 'hello' },
        });
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
});
