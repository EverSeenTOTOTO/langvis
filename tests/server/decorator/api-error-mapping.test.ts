import { api } from '@/server/decorator/api';
import bindController, { controller } from '@/server/decorator/controller';
import { ExceptionBase } from '@/server/libs/exceptions/exception.base';
import { ValidationException } from '@/shared/dto/base';
import express from 'express';
import type { Server } from 'node:http';

class NotFoundError extends ExceptionBase {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
  constructor() {
    super('not found');
  }
}
class ForbiddenError extends ExceptionBase {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;
  constructor() {
    super('forbidden');
  }
}
class ConflictError extends ExceptionBase {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
  constructor() {
    super('conflict');
  }
}
class BadRequestError extends ExceptionBase {
  readonly code = 'BAD_REQUEST';
  readonly statusCode = 400;
  constructor() {
    super('bad request');
  }
}

@controller('/err')
class ErrController {
  @api('/notfound')
  async notfound() {
    throw new NotFoundError();
  }
  @api('/forbidden')
  async forbidden() {
    throw new ForbiddenError();
  }
  @api('/conflict')
  async conflict() {
    throw new ConflictError();
  }
  @api('/badrequest')
  async badrequest() {
    throw new BadRequestError();
  }
  @api('/validation')
  async validation() {
    throw new ValidationException('field required');
  }
  @api('/internal')
  async internal() {
    throw new Error('boom');
  }
}

async function startServer(): Promise<Server> {
  const app = express();
  app.use(express.json());
  bindController(ErrController, app);
  return new Promise<Server>(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function get(server: Server, path: string) {
  const { port } = server.address() as { port: number };
  const res = await fetch(`http://localhost:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('api decorator ExceptionBase → statusCode mapping', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server?.close());

  it('maps 404 NotFound', async () => {
    const r = await get(server, '/err/notfound');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'not found', code: 'NOT_FOUND' });
  });

  it('maps 403 Forbidden', async () => {
    const r = await get(server, '/err/forbidden');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN');
  });

  it('maps 409 Conflict', async () => {
    const r = await get(server, '/err/conflict');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
  });

  it('maps 400 BadRequest (ExceptionBase, not ValidationException)', async () => {
    const r = await get(server, '/err/badrequest');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BAD_REQUEST');
  });

  it('maps ValidationException → 400 with details', async () => {
    const r = await get(server, '/err/validation');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Validation failed');
  });

  it('maps plain Error → 500', async () => {
    const r = await get(server, '/err/internal');
    expect(r.status).toBe(500);
  });
});
