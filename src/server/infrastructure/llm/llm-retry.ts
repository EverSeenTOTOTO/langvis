import type { APIError } from 'openai';
import { abortableDelay } from '@/server/utils/abort';
import type { LlmStreamChunk } from './llm.port';

// LLM 调用传输层重试：仅限「流式产出首个 delta 之前」的失败——已吐过内容就无法透明重放。
// 指数退避 1s/2s/4s，全程尊重 abort signal。

export const LLM_STREAM_MAX_RETRIES = 3;

const BACKOFF_BASE_MS = 1000;

export const backoffDelayMs = (attempt: number): number =>
  BACKOFF_BASE_MS * 2 ** attempt;

/** 可重试分类：网络/超时/429/5xx 可重试；4xx（参数/鉴权/配额外）与 abort 不可。 */
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return false;
  const status = (err as APIError)?.status;
  if (status === undefined) return true; // 连接失败/超时（无 HTTP 状态）
  if (status === 429) return true;
  return status >= 500;
}

// 流式调用重试包装：makeAttempt 每次重建完整调用（create + 消费）。 首个 delta 产出后的失败不可重放，直接上抛；每次重试经 onRetry 通知调用方记录遥测。
export async function* withStreamRetry<R>(
  makeAttempt: () => AsyncGenerator<LlmStreamChunk, R, void>,
  signal: AbortSignal,
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void,
): AsyncGenerator<LlmStreamChunk, R, void> {
  for (let attempt = 0; ; attempt++) {
    let produced = false;
    const iterator = makeAttempt()[Symbol.asyncIterator]();
    try {
      for (;;) {
        const r = await iterator.next();
        if (r.done) return r.value;
        produced = true;
        yield r.value;
      }
    } catch (err) {
      if (
        produced ||
        !isRetryableLlmError(err) ||
        attempt >= LLM_STREAM_MAX_RETRIES
      ) {
        throw err;
      }
      const delay = backoffDelayMs(attempt);
      onRetry?.(attempt + 1, err, delay);
      await abortableDelay(delay, signal);
    }
  }
}

/** 非流式调用重试：结果原子（无部分产出问题），可重试错误按同款退避重试。 */
export async function withRetry<R>(
  makeAttempt: () => Promise<R>,
  signal: AbortSignal,
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await makeAttempt();
    } catch (err) {
      if (!isRetryableLlmError(err) || attempt >= LLM_STREAM_MAX_RETRIES) {
        throw err;
      }
      const delay = backoffDelayMs(attempt);
      onRetry?.(attempt + 1, err, delay);
      await abortableDelay(delay, signal);
    }
  }
}
