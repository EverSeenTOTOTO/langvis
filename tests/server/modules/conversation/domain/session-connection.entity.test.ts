import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionConnection } from '@/server/modules/conversation/application/session-connection';
import type { SSEFrame } from '@/shared/types/events';
import { Transport } from '@/shared/transport';

class MockTransport extends Transport<SSEFrame> {
  isConnected = true;
  isConnecting = false;
  sentFrames: SSEFrame[] = [];
  closed = false;

  connect = vi.fn().mockResolvedValue(undefined);
  send = vi.fn((frame: SSEFrame) => {
    this.sentFrames.push(frame);
    return true;
  });
  close = vi.fn(() => {
    this.closed = true;
    this.isConnected = false;
  });
  disconnect = vi.fn(() => {
    this.send({ type: 'session_replaced' as const });
    this.close();
  });

  /** Expose protected emit for testing disconnect events */
  fireDisconnect() {
    this.dispatchEvent(new Event('disconnect'));
  }
}

describe('SessionConnection', () => {
  let onDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onDispose = vi.fn();
  });

  // need to restore real timers after each test
  // but vitest afterEach runs after all tests in this block

  function createConnection(id = 'conv_1', timeout: number = 5000) {
    return new SessionConnection(id, timeout, onDispose);
  }

  it('should attach transport and clear idle timer', () => {
    const conn = createConnection();
    const transport = new MockTransport();

    // Start idle timer manually
    conn.markIdle();
    conn.attach(transport);

    expect(conn.connectedCount).toBe(1);

    // Idle timer should not fire
    vi.advanceTimersByTime(10000);
    expect(onDispose).not.toHaveBeenCalled();
  });

  it('should broadcast send to all connected transports', () => {
    const conn = createConnection();
    const t1 = new MockTransport();
    const t2 = new MockTransport();
    conn.attach(t1);
    conn.attach(t2);

    const frame = { type: 'connected' as const };
    const result = conn.send(frame);

    expect(result).toBe(true);
    expect(t1.send).toHaveBeenCalledWith(frame);
    expect(t2.send).toHaveBeenCalledWith(frame);
  });

  it('should return false when no transports connected', () => {
    const conn = createConnection();
    expect(conn.send({ type: 'connected' as const })).toBe(false);
  });

  it('should remove transport on disconnect event', () => {
    const conn = createConnection();
    const transport = new MockTransport();
    conn.attach(transport);

    expect(conn.connectedCount).toBe(1);

    // Simulate disconnect event
    transport.fireDisconnect();

    expect(conn.connectedCount).toBe(0);
  });

  it('should start idle timer when all transports disconnect', () => {
    const conn = createConnection('conv_1', 1000);
    const t1 = new MockTransport();
    conn.attach(t1);

    t1.fireDisconnect();
    expect(conn.connectedCount).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('should not start idle timer when transports remain', () => {
    const conn = createConnection('conv_1', 1000);
    const t1 = new MockTransport();
    const t2 = new MockTransport();
    conn.attach(t1);
    conn.attach(t2);

    t1.fireDisconnect();
    expect(conn.connectedCount).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(onDispose).not.toHaveBeenCalled();
  });

  it('should dispose by closing all transports and calling onDispose', () => {
    const conn = createConnection();
    const t1 = new MockTransport();
    const t2 = new MockTransport();
    conn.attach(t1);
    conn.attach(t2);

    conn.dispose();

    expect(t1.close).toHaveBeenCalled();
    expect(t2.close).toHaveBeenCalled();
    expect(conn.connectedCount).toBe(0);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('should use close() not disconnect() on dispose', () => {
    const conn = createConnection();
    const transport = new MockTransport();
    conn.attach(transport);

    conn.dispose();

    expect(transport.close).toHaveBeenCalled();
    expect(transport.disconnect).not.toHaveBeenCalled();
  });

  it('markIdle should start timer only when transports empty', () => {
    const conn = createConnection('conv_1', 1000);
    const transport = new MockTransport();

    // markIdle with transport attached should not start timer
    conn.attach(transport);
    conn.markIdle();
    vi.advanceTimersByTime(2000);
    expect(onDispose).not.toHaveBeenCalled();

    // Remove transport, then markIdle
    transport.fireDisconnect();
    conn.markIdle();
    vi.advanceTimersByTime(1000);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('should skip disconnected transports when sending', () => {
    const conn = createConnection();
    const t1 = new MockTransport();
    const t2 = new MockTransport();
    conn.attach(t1);
    conn.attach(t2);

    t1.isConnected = false;
    const frame = { type: 'connected' as const };
    const result = conn.send(frame);

    expect(result).toBe(true);
    expect(t1.send).not.toHaveBeenCalled();
    expect(t2.send).toHaveBeenCalled();
  });
});
