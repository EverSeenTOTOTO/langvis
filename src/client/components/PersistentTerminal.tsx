import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Typography } from 'antd';

const { Text } = Typography;

// 常驻终端层:首次进入 /terminal 后永不卸载,路由切换仅切显隐——切走再回来
// 零冷启动(WS/PTY/CLI 全程存活)。链路:ghostty-web ⇄ ws ⇄ 服务端 PTY ⇄ langvis CLI。

let booted = false;

const TerminalCanvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | any>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    let term: any = null;
    let fit: any = null;
    let resizeObserver: ResizeObserver | null = null;

    // 容器尺寸就绪前 fit 可能得到 0 列——PTY 以 0×0 拉起即白屏
    const waitNonZeroSize = () =>
      new Promise<void>(resolve => {
        const check = () => {
          const el = containerRef.current;
          if (disposed) return resolve();
          if (el && el.clientWidth > 0 && el.clientHeight > 0) return resolve();
          requestAnimationFrame(check);
        };
        check();
      });

    const sendResize = (cols: number, rows: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    const connect = async () => {
      try {
        const { init, Terminal, FitAddon } = await import('ghostty-web');
        if (disposed) return;
        await init();
        if (disposed) return;

        if (!term) {
          term = new Terminal({
            fontSize: 13,
            theme: {
              background: '#14161f',
              foreground: '#c8cad8',
            },
          });
          fit = new FitAddon();
          term.loadAddon(fit);
          term.open(containerRef.current);
          term.onData((data: string) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(data);
            }
          });
          term.onResize(({ cols, rows }: { cols: number; rows: number }) =>
            sendResize(cols, rows),
          );
          termRef.current = term;
          fitRef.current = fit;

          // 显隐切换（display:none → block）与窗口调整的恢复通道
          resizeObserver = new ResizeObserver(() => {
            const el = containerRef.current;
            if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
            try {
              fitRef.current?.fit();
            } catch {
              /* surface 未就绪时的 fit 抛错忽略 */
            }
          });
          if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
          }
        }

        await waitNonZeroSize();
        if (disposed) return;
        fit.fit();

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const cols = term.cols > 0 ? term.cols : 80;
        const rows = term.rows > 0 ? term.rows : 24;
        const ws = new WebSocket(
          `${proto}//${location.host}/api/terminal/ws?cols=${cols}&rows=${rows}`,
        );
        wsRef.current = ws;
        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
          term?.focus();
          sendResize(term?.cols ?? 80, term?.rows ?? 24);
        };
        ws.onmessage = (event: MessageEvent) => {
          term?.write(event.data as string);
        };
        ws.onclose = () => {
          if (disposed) return;
          term?.write(
            '\r\n\x1b[33m(connection lost, reconnecting…)\x1b[0m\r\n',
          );
          const delay = Math.min(
            1000 * 2 ** reconnectAttemptRef.current,
            15_000,
          );
          reconnectAttemptRef.current += 1;
          setTimeout(() => {
            if (!disposed) void connect();
          }, delay);
        };
      } catch (err) {
        if (disposed) return;
        setFatal(err instanceof Error ? err.message : String(err));
      }
    };

    void connect();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      wsRef.current?.close();
      try {
        term?.dispose();
      } catch {
        /* dispose 竞态抛错忽略 */
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  if (fatal) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <Text type="danger">terminal failed: {fatal}</Text>
        <Button onClick={() => location.reload()}>reload</Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        boxSizing: 'border-box',
        padding: '12px',
        background: '#14161f',
      }}
    />
  );
};

export default function PersistentTerminal() {
  const { pathname } = useLocation();
  const [everVisited, setEverVisited] = useState(booted);
  const visible = pathname === '/terminal' || pathname.startsWith('/terminal/');

  useEffect(() => {
    if (visible && !booted) {
      booted = true;
      setEverVisited(true);
    }
  }, [visible]);

  if (!everVisited) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--header-height)',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        background: '#14161f',
        display: visible ? 'block' : 'none',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <TerminalCanvas />
    </div>
  );
}
