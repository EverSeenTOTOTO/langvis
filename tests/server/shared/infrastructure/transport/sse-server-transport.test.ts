import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SSEServerTransport } from '@/server/libs/infrastructure/transport/SSEServerTransport';

/** Minimal Express Response stand-in capturing written SSE chunks. */
function mockResponse() {
  const res = {
    writable: true,
    writableEnded: false,
    headersSent: false,
    writeHead: vi.fn(() => {
      res.headersSent = true;
    }),
    write: vi.fn((_chunk: string) => {
      return true;
    }),
    flush: vi.fn(),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
  };
  return res;
}

const mockReq = () => new EventEmitter();

const pingCount = (res: ReturnType<typeof mockResponse>) =>
  res.write.mock.calls.filter(c => (c[0] as string).startsWith(': ping'))
    .length;

describe('SSEServerTransport —— 哑管道 + 懒心跳', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('构造无副作用；首次 send 懒触发 writeHead + 帧，之后周期写 : ping', () => {
    const res = mockResponse();
    const transport = new SSEServerTransport(mockReq() as any, res as any);

    // 构造不发任何内容（哑管道——何时开始由外部控制）
    expect(res.write).not.toHaveBeenCalled();
    expect(res.writeHead).not.toHaveBeenCalled();

    // 首次 send 懒触发 writeHead + 写帧
    transport.send({ type: 'connected' } as any);
    expect(res.writeHead).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"connected"'),
    );
    expect(pingCount(res)).toBe(0);

    // 推进一个心跳周期 → 写出注释行（原生 EventSource 会忽略）
    vi.advanceTimersByTime(20_000);
    expect(pingCount(res)).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(pingCount(res)).toBe(2);
  });

  it('close() 后停止心跳', () => {
    const res = mockResponse();
    const transport = new SSEServerTransport(mockReq() as any, res as any);
    transport.send({ type: 'connected' } as any);

    vi.advanceTimersByTime(20_000);
    const pingsBeforeClose = pingCount(res);

    transport.close();
    vi.advanceTimersByTime(60_000);

    expect(pingCount(res)).toBe(pingsBeforeClose);
  });
});
