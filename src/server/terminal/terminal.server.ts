import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';
import pty from '@lydell/node-pty';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';
import Logger from '@/server/utils/logger';

const logger = Logger.child({ source: 'TerminalServer' });

const TERMINAL_WS_PATH = '/api/terminal/ws';
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** CLI 可执行入口：单用户自部署默认仓内相对路径，env 可覆盖。 */
const cliEntry = () =>
  process.env.LANGVIS_CLI_PATH ??
  path.resolve(process.cwd(), '../langvis-cli/bundle/gemini.js');

/** upgrade 请求的 http.IncomingMessage → AuthService 需要的 express Request 形状（仅用 headers）。 */
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

// 终端托管：浏览器终端画布 ⇄ ws ⇄ PTY ⇄ langvis CLI。
// 挂在 http upgrade 事件上（express 中间件不覆盖 upgrade，鉴权手动做）；组合根只 attach(httpServer)。
@Injectable()
export class TerminalServer {
  // PTY 默认工作区：/tmp/langvis-workspace 下随机目录（generateEphemeralPath 同源），
  // 每服务进程一个（刷新复用、重启换新）；LANGVIS_CLI_CWD 显式覆盖时优先。
  private defaultCliCwd: Promise<string> | undefined;

  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {}

  attach(server: {
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
        const user = await this.authService.getUser(req.headers.cookie ?? '');
        if (!user) throw new Error('unauthenticated');
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const cwd = process.env.LANGVIS_CLI_CWD ?? (await this.resolveCwd());

      wss.handleUpgrade(req, socket, head, ws => {
        this.handleConnection(ws, req, cwd);
      });
    });

    logger.info(`Terminal ws ready at ${TERMINAL_WS_PATH}`);
  }

  private resolveCwd(): Promise<string> {
    return (this.defaultCliCwd ??= (async () => {
      const dir = this.workspaceService.generateEphemeralPath();
      await fs.mkdir(dir, { recursive: true });
      return dir;
    })());
  }

  /** 单条 ws 连接 = 一个 PTY 会话 = 一个 CLI 进程；断开即杀（刷新由新进程 resume 会话）。 */
  private handleConnection(
    ws: WebSocket,
    req: IncomingMessage,
    cwd: string,
  ): void {
    const { cols, rows } = resolveColsRows(req);
    const origin =
      process.env.LANGVIS_SERVER_URL ??
      (req.headers.host
        ? `http://${req.headers.host}`
        : 'http://localhost:3000');

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
      cwd,
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
}
