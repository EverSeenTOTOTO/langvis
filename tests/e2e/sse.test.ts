import 'reflect-metadata';
import path from 'node:path';
import http from 'node:http';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from '@/server/index';

dotenv.config({ path: path.join(process.cwd(), '.env.development') });

// SSE 实时栈 e2e：激活 → text/event-stream + 首帧；未认证 401。 断线重连补发依赖 agent run（LLM），留 live 验证——此处锁传输层契约。

let app: Express;
let nestApp: Awaited<ReturnType<typeof createServer>>['nestApp'];
let server: http.Server;

let baseUrl: string;
const testEmail = `sse-${randomUUID()}@langvis.test`;
const cookies: string[] = [];

beforeAll(async () => {
  const booted = await createServer();
  app = booted.app;
  nestApp = booted.nestApp;
  server = app.listen(0);
  const addr = server.address() as import('node:net').AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server.close();
  server.closeAllConnections();
  await nestApp.close();
});

describe('SSE 激活（chat activate）', () => {
  it('未认证 401', async () => {
    const res = await request(app).get('/api/chat/activate/conv_none');
    expect(res.status).toBe(401);
  });

  it('注册 → 建会话 → 激活收到 event-stream 与首帧', async () => {
    const signUp = await request(app)
      .post('/api/auth/sign-up/email')
      .set('content-type', 'application/json')
      .send({
        email: testEmail,
        password: 'sse-e2e-pass-123',
        name: 'sse-e2e',
      });
    expect(signUp.status).toBe(200);
    const setCookie = signUp.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    cookies.push(...(Array.isArray(setCookie) ? setCookie : [setCookie!]));
    const cookieHeader = cookies.join('; ');

    const created = await await request(app)
      .post('/api/conversation')
      .set('content-type', 'application/json')
      .set('cookie', cookieHeader)
      .send({ name: 'sse-e2e-conv' });
    expect(created.status).toBe(201);
    const conversationId = created.body.id as string;
    expect(conversationId).toBeTruthy();

    // 原生 http：流式响应收到首帧 data: 行即断言成功并主动断开
    const firstFrame = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/api/chat/activate/${conversationId}`,
        { headers: { cookie: cookieHeader } },
        res => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          const timeout = setTimeout(
            () => reject(new Error('no SSE frame within 10s')),
            10_000,
          );
          let buf = '';
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split('\n').filter(l => l.startsWith('data: '));
            if (lines.length > 0) {
              clearTimeout(timeout);
              req.destroy();
              resolve(lines[0]!.slice('data: '.length));
            }
          });
          res.on('error', e => {
            clearTimeout(timeout);
            reject(e);
          });
        },
      );
      req.on('error', e => {
        if (!/socket hang up|ECONNRESET/i.test(String(e.message))) {
          reject(e);
        }
      });
    });

    // 首帧是 StreamFrame JSON（任意帧即证明激活 + 投影通道打通）
    expect(() => JSON.parse(firstFrame)).not.toThrow();
  });
});
