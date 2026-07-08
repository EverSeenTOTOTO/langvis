import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SSEServerTransport } from '@/server/libs/infrastructure/transport/SSEServerTransport';

/** Minimal Express Response stand-in capturing written SSE chunks. */
function mockResponse() {
  const res = {
    writable: true,
    writableEnded: false,
    writeHead: vi.fn(),
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

describe('SSEServerTransport —— 心跳保活', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('构造后下发 connected 帧；静默间隔后周期写 : ping 注释行', () => {
    const res = mockResponse();
    new SSEServerTransport(mockReq() as any, res as any);

    // 首帧为 connected
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"connected"'),
    );
    const pingsBefore = res.write.mock.calls.filter(c =>
      (c[0] as string).startsWith(': ping'),
    ).length;
    expect(pingsBefore).toBe(0);

    // 推进一个心跳周期 → 写出注释行（原生 EventSource 会忽略）
    vi.advanceTimersByTime(20_000);
    const pingsAfter1 = res.write.mock.calls.filter(c =>
      (c[0] as string).startsWith(': ping'),
    ).length;
    expect(pingsAfter1).toBe(1);

    vi.advanceTimersByTime(20_000);
    const pingsAfter2 = res.write.mock.calls.filter(c =>
      (c[0] as string).startsWith(': ping'),
    ).length;
    expect(pingsAfter2).toBe(2);
  });

  it('close() 后停止心跳', () => {
    const res = mockResponse();
    const transport = new SSEServerTransport(mockReq() as any, res as any);

    vi.advanceTimersByTime(20_000);
    const pingsBeforeClose = res.write.mock.calls.filter(c =>
      (c[0] as string).startsWith(': ping'),
    ).length;

    transport.close();
    vi.advanceTimersByTime(60_000);

    const pingsAfterClose = res.write.mock.calls.filter(c =>
      (c[0] as string).startsWith(': ping'),
    ).length;
    expect(pingsAfterClose).toBe(pingsBeforeClose);
  });
});
