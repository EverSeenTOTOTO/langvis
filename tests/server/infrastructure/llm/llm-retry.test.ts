import { describe, it, expect, vi, afterAll } from 'vitest';
import {
  backoffDelayMs,
  isRetryableLlmError,
  withStreamRetry,
  LLM_STREAM_MAX_RETRIES,
} from '@/server/infrastructure/llm/llm-retry';

const httpError = (status?: number) =>
  Object.assign(new Error('boom'), { status }) as never;

describe('isRetryableLlmError', () => {
  it('无 HTTP 状态（网络/超时）可重试；429/5xx 可重试', () => {
    expect(isRetryableLlmError(httpError())).toBe(true);
    expect(isRetryableLlmError(httpError(429))).toBe(true);
    expect(isRetryableLlmError(httpError(500))).toBe(true);
    expect(isRetryableLlmError(httpError(503))).toBe(true);
  });

  it('4xx（参数/鉴权/不存在）与 abort 不可重试', () => {
    expect(isRetryableLlmError(httpError(400))).toBe(false);
    expect(isRetryableLlmError(httpError(401))).toBe(false);
    expect(isRetryableLlmError(httpError(403))).toBe(false);
    expect(isRetryableLlmError(httpError(404))).toBe(false);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    expect(isRetryableLlmError(abortErr)).toBe(false);
  });
});

describe('withStreamRetry', () => {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    cb: TimerHandler,
    _ms?: number,
  ) => {
    queueMicrotask(() => (cb as () => void)());
    return 0 as never;
  }) as unknown as typeof setTimeout);

  it('首 delta 前的失败按退避重试，成功后正常流式返回', async () => {
    let calls = 0;
    const makeAttempt = () =>
      (async function* () {
        calls++;
        if (calls < 3) throw httpError(503);
        yield 'he';
        yield 'llo';
        return 'hello';
      })();
    const out: string[] = [];
    let ret = '';
    const iter = withStreamRetry(makeAttempt, new AbortController().signal);
    for (;;) {
      const r = await iter.next();
      if (r.done) {
        ret = r.value;
        break;
      }
      out.push(r.value);
    }
    expect(out).toEqual(['he', 'llo']);
    expect(ret).toBe('hello');
    expect(calls).toBe(3);
  });

  it('已产出 delta 后的失败不重试（无法透明重放）', async () => {
    let calls = 0;
    const make = () =>
      (async function* () {
        calls++;
        yield 'par';
        throw httpError(500);
      })();
    const iter = withStreamRetry(make, new AbortController().signal);
    const chunks: string[] = [];
    await expect(
      (async () => {
        for (;;) {
          const r = await iter.next();
          if (r.done) return r.value;
          chunks.push(r.value);
        }
      })(),
    ).rejects.toThrow('boom');
    expect(chunks).toEqual(['par']);
    expect(calls).toBe(1);
  });

  it('重试耗尽（达上限）后抛最后错误', async () => {
    let calls = 0;
    const make = () =>
      (async function* () {
        calls++;
        throw httpError(429);
      })();
    const iter = withStreamRetry(make, new AbortController().signal);
    await expect(iter.next()).rejects.toThrow('boom');
    expect(calls).toBe(LLM_STREAM_MAX_RETRIES + 1);
  });

  it('不可重试错误直接上抛（单次调用）', async () => {
    let calls = 0;
    const make = () =>
      (async function* () {
        calls++;
        throw httpError(401);
      })();
    const iter = withStreamRetry(make, new AbortController().signal);
    await expect(iter.next()).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('退避指数：1s/2s/4s', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
  });

  it('abort 打断退避等待', async () => {
    const controller = new AbortController();
    const make = () =>
      (async function* () {
        throw httpError(503);
      })();
    const iter = withStreamRetry(make, controller.signal);
    const p = iter.next();
    controller.abort();
    await expect(p).rejects.toThrow();
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
