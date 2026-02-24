import bindApi, { api } from '@/server/decorator/api';
import { file, files, request, response } from '@/server/decorator/param';
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

it('api with file upload', async () => {
  class Demo {
    @api('/upload-single', { method: 'post' })
    async uploadSingle(
      @file('file') uploadedFile: Express.Multer.File,
      @request() req: Request,
      @response() res: Response,
    ) {
      res.json({
        filename: uploadedFile?.originalname,
        mimetype: uploadedFile?.mimetype,
        size: uploadedFile?.size,
        body: req.body,
      });
    }

    @api('/upload-array', { method: 'post' })
    async uploadArray(
      @files('files') uploadedFiles: Express.Multer.File[],
      @response() res: Response,
    ) {
      res.json({
        count: uploadedFiles?.length,
        names: uploadedFiles?.map(f => f.originalname),
      });
    }

    @api('/upload-fields', { method: 'post' })
    async uploadFields(
      @file('avatar') avatar: Express.Multer.File,
      @files('gallery') gallery: Express.Multer.File[],
      @response() res: Response,
    ) {
      res.json({
        avatar: avatar?.originalname,
        galleryCount: gallery?.length,
      });
    }

    @api('/upload-auto-file', { method: 'post' })
    async uploadAutoFile(
      @file() uploadedFile: Express.Multer.File,
      @response() res: Response,
    ) {
      res.json({ filename: uploadedFile?.originalname });
    }

    @api('/upload-maxcount', { method: 'post' })
    async uploadMaxCount(
      @files('docs', { maxCount: 2 }) docs: Express.Multer.File[],
      @response() res: Response,
    ) {
      res.json({ count: docs?.length });
    }
  }

  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  bindApi(new Demo(), '', app);

  await new Promise<void>((resolve, reject) => {
    const port = 3003;
    const server = app.listen(port, async () => {
      try {
        // Test single file upload
        const formData1 = new FormData();
        formData1.append('file', new Blob(['test content']), 'test.txt');
        formData1.append('userId', '123');

        const single = await fetch(`http://localhost:${port}/upload-single`, {
          method: 'post',
          body: formData1,
        }).then(rsp => rsp.json());

        expect(single.filename).toBe('test.txt');
        expect(single.size).toBe(12);
        expect(single.body).toEqual({ userId: '123' });

        // Test array upload
        const formData2 = new FormData();
        formData2.append('files', new Blob(['a']), 'a.txt');
        formData2.append('files', new Blob(['b']), 'b.txt');

        const array = await fetch(`http://localhost:${port}/upload-array`, {
          method: 'post',
          body: formData2,
        }).then(rsp => rsp.json());

        expect(array.count).toBe(2);
        expect(array.names).toEqual(['a.txt', 'b.txt']);

        // Test fields upload
        const formData3 = new FormData();
        formData3.append('avatar', new Blob(['avatar']), 'avatar.png');
        formData3.append('gallery', new Blob(['g1']), 'g1.jpg');
        formData3.append('gallery', new Blob(['g2']), 'g2.jpg');

        const fields = await fetch(`http://localhost:${port}/upload-fields`, {
          method: 'post',
          body: formData3,
        }).then(rsp => rsp.json());

        expect(fields.avatar).toBe('avatar.png');
        expect(fields.galleryCount).toBe(2);

        // Test auto file detection (uses multer().none() which allows no files)
        const formData4 = new FormData();
        formData4.append('data', 'value');

        const noFile = await fetch(
          `http://localhost:${port}/upload-auto-file`,
          {
            method: 'post',
            body: formData4,
          },
        ).then(rsp => rsp.json());

        expect(noFile.filename).toBeUndefined();

        // Test maxCount - should accept 2 files
        const formData5 = new FormData();
        formData5.append('docs', new Blob(['a']), 'a.txt');
        formData5.append('docs', new Blob(['b']), 'b.txt');

        const maxCountOk = await fetch(
          `http://localhost:${port}/upload-maxcount`,
          {
            method: 'post',
            body: formData5,
          },
        ).then(rsp => rsp.json());

        expect(maxCountOk.count).toBe(2);

        // Test maxCount exceeded - should reject with 400
        const formData6 = new FormData();
        formData6.append('docs', new Blob(['a']), 'a.txt');
        formData6.append('docs', new Blob(['b']), 'b.txt');
        formData6.append('docs', new Blob(['c']), 'c.txt');

        const maxCountExceeded = await fetch(
          `http://localhost:${port}/upload-maxcount`,
          {
            method: 'post',
            body: formData6,
          },
        ).then(rsp => ({ status: rsp.status, json: rsp.json() }));

        expect(maxCountExceeded.status).toBe(400);

        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
});
