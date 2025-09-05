import { api } from '@/server/decorator/api';
import bindController, { controller } from '@/server/decorator/controller';
import bodyParser from 'body-parser';
import express, { type Request, type Response } from 'express';
import { container, inject, injectable } from 'tsyringe';

it('controller', async () => {
  @injectable()
  @controller('/ns')
  class Demo {
    constructor(
      @inject('foo') private foo?: string,
      @inject('baz') private bar?: string,
    ) {}

    @api('/get')
    async getData(req: Request, res: Response) {
      res.json({ data: req.query, foo: this.foo, bar: this.bar });
    }
  }

  const app = express();

  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  container.register('foo', { useValue: 'hello' });
  container.register('baz', { useValue: 'world' });

  bindController(Demo, app);

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
