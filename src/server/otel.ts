import {
  trace,
  metrics,
  context,
  type Span,
  type SpanOptions,
  type Attributes,
  type AttributeValue,
  SpanStatusCode,
} from '@opentelemetry/api';

// 业务代码统一从这里取 tracer/meter；未注册 provider 时返回 Noop，span 调用空转。
export const tracer = trace.getTracer('langvis');
export const meter = metrics.getMeter('langvis');

// 包 async generator 进 span，每次 next() 重建 context 保父链（ALS 不跨 yield）。
// startActiveSpan 回调形式对 async gen 失效：body 在 yield 消费时才跑，span 已非 active。
export async function* traceGen<T, R = void>(
  name: string,
  attrs: Attributes,
  gen: (span: Span) => AsyncGenerator<T, R, void>,
): AsyncGenerator<T, R, void> {
  const span = tracer.startSpan(name, { attributes: attrs });
  const ctx = trace.setSpan(context.active(), span);
  const iter = gen(span);
  try {
    let res = await context.with(ctx, () => iter.next());
    while (!res.done) {
      yield res.value;
      res = await context.with(ctx, () => iter.next());
    }
    return res.value;
  } catch (err) {
    recordErr(span, err);
    throw err;
  } finally {
    span.end();
  }
}

/** 包普通 async 函数进 span——startActiveSpan 回调形式对 async fn OK（ALS 跨 await 保持）。 */
export async function traceSync<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async span => {
    try {
      return await fn(span);
    } catch (err) {
      recordErr(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

function recordErr(span: Span, err: unknown): void {
  span.recordException(err as Error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: (err as Error)?.message ?? String(err),
  });
}

// 属性构造助手——业务侧用 { 'tool.name': x } 直传 Attributes，省去类型标注。
export type { Attributes, AttributeValue, SpanOptions };
