import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from '@/server/index';

dotenv.config({
  path: path.join(process.cwd(), '.env.development'),
});

// Phase 0 e2e 基线（对拍基准）：auth 豁免表 / 401 / requestId / 探针 404 /
// better-auth 注册登录 / Nest 双挂载。跑真 server（需 DB）：make test-e2e。

let app: Express;
let nestApp: Awaited<ReturnType<typeof createServer>>['nestApp'];
const testEmail = `e2e-${randomUUID()}@langvis.test`;
const testPassword = 'e2e-baseline-pass-123';

beforeAll(async () => {
  const booted = await createServer();
  app = booted.app;
  nestApp = booted.nestApp;
});

afterAll(async () => {
  await nestApp.close();
});

describe('e2e 基线（旧栈 + Nest 双挂载）', () => {
  it('豁免路径免鉴权：get-session 未登录返回 null 会话', async () => {
    const res = await request(app).get('/api/auth/get-session');
    expect(res.status).toBe(200);
  });

  it('受保护路径未登录 401 + redirect 指向 /login', async () => {
    const res = await request(app).get('/api/conversation/workspace');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      redirect: '/login',
    });
  });

  it('requestId：透传 x-request-id；缺失时自动生成 req_ 前缀', async () => {
    const echoed = await request(app)
      .get('/api/models')
      .set('x-request-id', 'req_e2e_echo');
    expect(echoed.headers['x-request-id']).toBe('req_e2e_echo');

    const generated = await request(app).get('/api/models');
    expect(String(generated.headers['x-request-id'])).toMatch(/^req_/);
  });

  it('探针路径 404（fail2ban 原料），不进 SSR 渲染', async () => {
    const res = await request(app).get('/wp-admin/setup.php');
    expect(res.status).toBe(404);
    // rejectProbe 用 end() 直写，无 content-type；断言 body 即可
    expect(res.text).toBe('Not Found');
  });

  it('SSR 页面路由返回 HTML', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('注册 → 登录 → 带 cookie 访问受保护路径 + Nest 双挂载路由', async () => {
    const signUp = await request(app)
      .post('/api/auth/sign-up/email')
      .set('content-type', 'application/json')
      .send({ email: testEmail, password: testPassword, name: 'e2e-baseline' });
    expect([200, 201]).toContain(signUp.status);

    const agent = request.agent(app);
    const signIn = await agent
      .post('/api/auth/sign-in/email')
      .set('content-type', 'application/json')
      .send({ email: testEmail, password: testPassword });
    expect(signIn.status).toBe(200);

    const protectedRes = await agent.get('/api/conversation/workspace');
    expect(protectedRes.status).toBe(200);

    const nestRes = await agent.get('/api/models');
    expect(nestRes.status).toBe(200);
  });
});
