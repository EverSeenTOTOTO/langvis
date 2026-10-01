import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';

vi.mock('@lydell/node-pty', () => {
  const spawns: Array<{
    file: string;
    args: string[];
    env: Record<string, string>;
    cols: number;
    rows: number;
    written: string[];
    resizes: Array<{ cols: number; rows: number }>;
    killed: boolean;
    dataHandlers: Array<(d: string) => void>;
    exitHandlers: Array<(e: { exitCode: number }) => void>;
  }> = [];
  const pty = {
    __spawns: spawns,
    spawn: vi.fn(
      (
        file: string,
        args: string[],
        opts: { env: Record<string, string>; cols: number; rows: number },
      ) => {
        const rec = {
          file,
          args,
          env: opts.env,
          cols: opts.cols,
          rows: opts.rows,
          written: [] as string[],
          resizes: [] as Array<{ cols: number; rows: number }>,
          killed: false,
          dataHandlers: [] as Array<(d: string) => void>,
          exitHandlers: [] as Array<(e: { exitCode: number }) => void>,
        };
        spawns.push(rec);
        return {
          get pid() {
            return 4242;
          },
          write: (d: string) => rec.written.push(d),
          resize: (cols: number, rows: number) =>
            rec.resizes.push({ cols, rows }),
          kill: () => {
            rec.killed = true;
          },
          onData: (cb: (d: string) => void) => rec.dataHandlers.push(cb),
          onExit: (cb: (e: { exitCode: number }) => void) =>
            rec.exitHandlers.push(cb),
        };
      },
    ),
  };
  return { default: pty };
});

import pty from '@lydell/node-pty';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import { attachTerminalServer } from '@/server/terminal/terminal.server';

const mockedPty = vi.mocked(pty.spawn);
const spawns = (pty as unknown as { __spawns: Array<Record<string, unknown>> })
  .__spawns;

// authService 经 attachTerminalServer 显式传入；每个用例构造自己的实例
let authService: AuthService;
function fakeAuth(user: { id: string } | null): void {
  authService = {
    getUser: vi.fn(async () => user),
  } as unknown as AuthService;
}

function startServer(): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise(resolve => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404).end();
    });
    attachTerminalServer(server, authService);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () =>
          new Promise<void>(done => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

describe('terminal.server（PTY 托管）', () => {
  beforeEach(() => {
    spawns.length = 0;
    mockedPty.mockClear();
    process.env.LANGVIS_CLI_PATH = '/tmp/fake-cli.js';
    process.env.LANGVIS_SERVER_URL = 'http://test-origin';
  });

  it('未认证的 upgrade 被 401 拒绝且不 spawn', async () => {
    fakeAuth(null);
    const { port, close } = await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/ws`);
    const failure = new Promise<unknown>(res => ws.on('error', res));
    await failure;
    expect(spawns).toHaveLength(0);
    await close();
  });

  it('认证通过：spawn CLI 并注入会话 env；输入直传、resize 走控制帧、断开即杀', async () => {
    fakeAuth({ id: 'user_1' });
    const { port, close } = await startServer();
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal/ws?cols=120&rows=40`,
    );
    await new Promise<void>(res => ws.on('open', res));

    expect(spawns).toHaveLength(1);
    const spawn = spawns[0]!;
    expect(spawn['file']).toBe(process.execPath);
    expect(spawn['args']).toEqual(['/tmp/fake-cli.js']);
    expect(spawn['cols']).toBe(120);
    expect(spawn['rows']).toBe(40);
    const env = spawn['env'] as Record<string, string>;
    expect(env['LANGVIS_SERVER_URL']).toBe('http://test-origin');
    expect(env['GEMINI_CLI_TRUST_WORKSPACE']).toBe('true');

    ws.send('hello');
    ws.send('{"type":"resize","cols":100,"rows":30}');
    await new Promise<void>(res =>
      setTimeout(() => {
        expect(spawn['written']).toEqual(['hello']);
        expect(spawn['resizes']).toEqual([{ cols: 100, rows: 30 }]);
        res();
      }, 50),
    );

    ws.close();
    await new Promise<void>(res =>
      setTimeout(() => {
        expect(spawn['killed']).toBe(true);
        res();
      }, 50),
    );
    await close();
  });

  it('PTY 输出回传 ws；PTY 退出关闭 ws', async () => {
    fakeAuth({ id: 'user_1' });
    const { port, close } = await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/ws`);
    await new Promise<void>(res => ws.on('open', res));
    const spawn = spawns[0]!;

    const dataHandlers = spawn['dataHandlers'] as Array<(d: string) => void>;
    dataHandlers[0]?.('welcome-screen');
    const got = await new Promise<string>(res =>
      ws.on('message', (d: WebSocket.RawData) => res(d.toString())),
    );
    expect(got).toBe('welcome-screen');

    const closed = new Promise<void>(res => ws.on('close', res));
    const exitHandlers = spawn['exitHandlers'] as Array<
      (e: { exitCode: number }) => void
    >;
    exitHandlers[0]?.({ exitCode: 0 });
    await closed;
    await close();
  });
});
