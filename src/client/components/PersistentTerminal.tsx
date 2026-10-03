import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Typography } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { useStore } from '@/client/store';
import '@xterm/xterm/css/xterm.css';

const { Text } = Typography;

// 常驻终端层:首次进入 /terminal 后永不卸载,路由切换仅切显隐——切走再回来
// 零冷启动(WS/PTY/CLI 全程存活)。链路:xterm ⇄ ws ⇄ 服务端 PTY ⇄ langvis CLI。

let booted = false;

const TerminalCanvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // 首条 PTY 输出前显示启动提示（CLI 冷启动 1-3s 黑屏无反馈）
  const [ptyAlive, setPtyAlive] = useState(false);

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
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        if (disposed) return;

        if (!term) {
          term = new Terminal({
            fontSize: 13,
            theme: {
              background: '#14161f',
              foreground: '#c8cad8',
              cursor: '#c8cad8',
            },
            allowProposedApi: true,
          });
          fit = new FitAddon();
          term.loadAddon(fit);
          term.open(containerRef.current);
          // CLI 经 OSC 0/2 设置的窗口标题 → 浏览器标签页标题(dynamicWindowTitle 链路终点)
          term.onTitleChange((title: string) => {
            document.title = title;
          });
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
          setPtyAlive(true);
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
        position: 'relative',
      }}
    >
      {!ptyAlive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'rgba(200, 202, 216, 0.45)',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          <span className="langvis-terminal-boot-dot" />
          starting terminal…
        </div>
      )}
    </div>
  );
};

export default function PersistentTerminal() {
  const { pathname } = useLocation();
  const settingStore = useStore('setting');
  const layerRef = useRef<HTMLDivElement>(null);
  const [everVisited, setEverVisited] = useState(booted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const visible = pathname === '/terminal' || pathname.startsWith('/terminal/');

  useEffect(() => {
    if (visible && !booted) {
      booted = true;
      setEverVisited(true);
    }
  }, [visible]);

  // 全屏状态跟踪；退出（含长按 Esc）时同步释放键盘锁
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) {
        (
          navigator as { keyboard?: { unlock?: () => void } }
        ).keyboard?.unlock?.();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // 全屏目标 = 终端层本身：header 天然不在全屏元素内，自动隐藏。浏览器保留键（ctrl+w/t/n）
  // 只有 Keyboard Lock API（需全屏）才能捕获，进入全屏时随行锁定——按键直达 xterm（ctrl+w → 删词）。
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await layerRef.current?.requestFullscreen();
      await (
        navigator as {
          keyboard?: { lock?: (keys: string[]) => Promise<void> };
        }
      ).keyboard?.lock?.(['KeyW', 'KeyT', 'KeyN', 'KeyR']);
    } catch {
      /* 键盘锁失败不阻断全屏 */
    }
  };

  if (!everVisited) return null;

  return (
    <div
      ref={layerRef}
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
      <Button
        size="small"
        type="text"
        onClick={() => void toggleFullscreen()}
        style={{
          position: 'absolute',
          top: 12,
          right: 20,
          zIndex: 10,
          color: 'rgba(200, 202, 216, 0.55)',
        }}
        title={
          isFullscreen
            ? settingStore.tr('Exit fullscreen')
            : settingStore.tr('Fullscreen terminal')
        }
      >
        {isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      </Button>
    </div>
  );
}
