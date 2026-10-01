import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { container } from 'tsyringe';
import { WebSocketServer, type WebSocket } from 'ws';
import pty from '@lydell/node-pty';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import type { Request } from 'express';
import Logger from '@/server/utils/logger';

const logger = Logger.child({ source: 'TerminalServer' });

const TERMINAL_WS_PATH = '/api/terminal/ws';
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** CLI 可执行入口与工作区：单用户自部署默认仓内相对路径，env 可覆盖。 */
const cliEntry = () =>
  process.env.LANGVIS_CLI_PATH ??
  path.resolve(process.cwd(), '../langvis-cli/bundle/gemini.js');
const cliCwd = () => process.env.LANGVIS_CLI_CWD ?? process.cwd();

/** upgrade 请求的 http.IncomingMessage → AuthService 需要的 express Request 形状（仅用 headers）。 */
function asExpressReq(req: IncomingMessage): Request {
  return req as unknown as Request;
}

function extractSessionCookie(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  const hit = cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('better-auth.session_token='));
  return hit;
}

function resolveColsRows(req: IncomingMessage): {
  cols: number;
  rows: number;
} {
  const url = new URL(req.url ?? '', 'http://internal');
  const cols = Number(url.searchParams.get('cols'));
  const rows = Number(url.searchParams.get('rows'));
  return {
    cols: Number.isInteger(cols) && cols > 0 ? cols : DEFAULT_COLS,
    rows: Number.isInteger(rows) && rows > 0 ? rows : DEFAULT_ROWS,
  };
}

/** 浏览器 → CLI 的控制帧（resize）；其余按终端输入直传。 */
function isResizeFrame(data: unknown): data is { cols: number; rows: number } {
  if (typeof data !== 'string') return false;
  if (!data.startsWith('{"type":"resize"')) return false;
  try {
    const parsed = JSON.parse(data) as {
      type?: string;
      cols?: unknown;
      rows?: unknown;
    };
    return (
      parsed.type === 'resize' &&
      Number.isInteger(parsed.cols) &&
      Number.isInteger(parsed.rows) &&
      (parsed.cols as number) > 0 &&
      (parsed.rows as number) > 0
    );
  } catch {
    return false;
  }
}

/** 单条 ws 连接 = 一个 PTY 会话 = 一个 CLI 进程；断开即杀（刷新由新进程 resume 会话）。 */
function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  const { cols, rows } = resolveColsRows(req);
  const origin =
    process.env.LANGVIS_SERVER_URL ??
    (req.headers.host ? `http://${req.headers.host}` : 'http://localhost:3000');

  const env: Record<string, string> = {
    ...process.env,
    LANGVIS_SERVER_URL: origin,
    LANGVIS_SESSION_COOKIE: extractSessionCookie(req) ?? '',
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    TERM: 'xterm-256color',
  } as Record<string, string>;

  const proc = pty.spawn(process.execPath, [cliEntry()], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cliCwd(),
    env,
  });
  logger.info(`PTY session started (pid ${proc.pid})`);

  proc.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  proc.onExit(({ exitCode }) => {
    logger.info(`PTY exited (${exitCode})`);
    ws.close();
  });

  ws.on('message', data => {
    const text = data.toString();
    if (isResizeFrame(text)) {
      const frame = JSON.parse(text) as { cols: number; rows: number };
      proc.resize(frame.cols, frame.rows);
      return;
    }
    proc.write(text);
  });
  ws.on('close', () => {
    proc.kill();
  });
  ws.on('error', () => {
    proc.kill();
  });
}

// 终端托管：浏览器终端画布 ⇄ ws ⇄ PTY ⇄ langvis CLI。
// 挂在 http upgrade 事件上（express 中间件不覆盖 upgrade，鉴权手动做）；NestJS 迁移时归位 gateway。
export function attachTerminalServer(server: {
  on: (
    event: 'upgrade',
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ) => void;
}): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== TERMINAL_WS_PATH) return;

    try {
      const authService = container.resolve(AuthService);
      const user = await authService.getUser(asExpressReq(req));
      if (!user) throw new Error('unauthenticated');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      handleConnection(ws, req);
    });
  });

  logger.info(`Terminal ws ready at ${TERMINAL_WS_PATH}`);
}
