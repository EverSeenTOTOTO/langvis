import type { RunErrorCode } from '@/shared/types/events';

// OpenAI SDK 错误形态（跨 provider 兼容的最小面）：status 为 HTTP 状态码。
interface ProviderErrorShape {
  status?: number | string;
  message?: string;
  code?: string;
}

function asProviderError(err: unknown): ProviderErrorShape | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const shape = err as ProviderErrorShape;
  return typeof shape.status !== 'undefined' ? shape : undefined;
}

/** 领域错误 → RunErrorCode 分类（error/tool_error 事件的稳定分类码）。 */
export function classifyError(err: unknown): RunErrorCode {
  const domain = err as { code?: string };
  if (typeof domain?.code === 'string') {
    switch (domain.code) {
      case 'TOOL_EXECUTION_ERROR':
        return 'internal';
      case 'CONFIG_VALIDATION_ERROR':
        return 'internal';
    }
  }

  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/context.*(length|window|overflow)|maximum context/i.test(message)) {
    return 'context_overflow';
  }
  if (/abort|cancel/i.test(message) && /timeout|timed?\s*out/i.test(message)) {
    return 'timeout';
  }
  if (/timed?\s*out|ETIMEDOUT|ECONNRESET.*(timed|timeout)/i.test(message)) {
    return 'timeout';
  }

  const provider = asProviderError(err);
  if (provider) {
    const status = Number(provider.status);
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth';
    if (status >= 500) return 'provider';
    if (status === 408) return 'timeout';
  }

  if (/parse|invalid response|missing or invalid/i.test(message)) {
    return 'parse';
  }

  return 'internal';
}
