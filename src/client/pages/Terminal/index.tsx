import { useEffect, useRef } from 'react';
import { Typography } from 'antd';
import ClientOnly from '@/client/components/ClientOnly';

const { Text } = Typography;

// 浏览器终端：ghostty-web 渲染 ⇄ ws ⇄ 服务端 PTY ⇄ langvis CLI。
// 重连 = 新 CLI 进程自动 resume workspace 会话（历史重放），不保留终端画面。
const TerminalCanvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const termRef = useRef<any>(null);

  const wsRef = useRef<WebSocket | any>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    let term: any = null;

    const connect = async () => {
      const { init, Terminal, FitAddon } = await import('ghostty-web');
      if (disposed) return;
      await init();

      if (!term) {
        term = new Terminal({
          fontSize: 13,
          theme: {
            background: '#14161f',
            foreground: '#c8cad8',
          },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        if (containerRef.current) {
          term.open(containerRef.current);
          fit.fit();
        }
        term.onData((data: string) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(data);
          }
        });
        term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });
        termRef.current = term;
      }

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const cols = term.cols ?? 80;
      const rows = term.rows ?? 24;
      const ws = new WebSocket(
        `${proto}//${location.host}/api/terminal/ws?cols=${cols}&rows=${rows}`,
      );
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        term?.focus();
      };
      ws.onmessage = (event: MessageEvent) => {
        term?.write(event.data as string);
      };
      ws.onclose = () => {
        if (disposed) return;
        term?.write('\r\n\x1b[33m(connection lost, reconnecting…)\x1b[0m\r\n');
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15_000);
        reconnectAttemptRef.current += 1;
        setTimeout(() => {
          if (!disposed) void connect();
        }, delay);
      };
    };

    void connect();

    const onWindowResize = () => {
      // fit 后 onResize 会发 resize 帧
      containerRef.current
        ?.querySelector('canvas')
        ?.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onWindowResize);
      wsRef.current?.close();
      term?.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        height: 'calc(100vh - 64px - 24px)',
        padding: '16px',
        background: '#14161f',
      }}
    />
  );
};

const TerminalPage = () => (
  <ClientOnly fallback={<Text>loading terminal…</Text>}>
    <TerminalCanvas />
  </ClientOnly>
);

export default TerminalPage;
