import { describe, it, expect, afterAll } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';

// traceGen 用 otel.ts 模块加载时缓存的 tracer——必须在 import otel 之前注册 provider，否则拿到 NoopTracer。
// contextManager 用 AsyncLocalStorageContextManager（与生产 tracing.ts 一致）：Bun 上 AsyncHooks 丢 context。
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);
context.setGlobalContextManager(new AsyncLocalStorageContextManager());

// 动态 import：此时全局 provider 已就位，otel.ts 的 trace.getTracer 拿到真 tracer。
const { traceGen, traceSync } = await import('@/server/otel');

afterAll(async () => {
  await provider.forceFlush();
  await provider.shutdown();
});

async function drain<T>(gen: AsyncGenerator<T>): Promise<void> {
  for await (const _ of gen) void _;
}

describe('traceGen / traceSync 父链', () => {
  it('async generator 子 span 的 parentSpanId 指向父 span（而非各自独立根）', async () => {
    exporter.reset();

    await drain(
      traceGen('agent.run', { 'run.id': 'r1' }, async function* () {
        yield* traceGen(
          'gen_ai.chat',
          { 'gen_ai.request.model': 'x' },
          async function* () {
            yield 'delta1';
            yield 'delta2';
          },
        );
        yield* traceGen('tool.call', { 'tool.name': 't' }, async function* () {
          yield 't-done';
        });
      }),
    );

    const spans = exporter.getFinishedSpans();
    const byName = Object.fromEntries(spans.map(s => [s.name, s]));
    const agentRun = byName['agent.run'];
    const genAi = byName['gen_ai.chat'];
    const toolCall = byName['tool.call'];

    expect(spans.length).toBe(3);
    expect(agentRun).toBeDefined();
    expect(genAi).toBeDefined();
    expect(toolCall).toBeDefined();

    // 核心断言：子 span 的 parentSpanContext.spanId == 父 spanId（父链不断）
    expect(agentRun.parentSpanContext).toBeUndefined();
    expect(genAi.parentSpanContext?.spanId).toBe(agentRun.spanContext().spanId);
    expect(toolCall.parentSpanContext?.spanId).toBe(
      agentRun.spanContext().spanId,
    );

    expect(agentRun.attributes?.['run.id']).toBe('r1');
    expect(genAi.attributes?.['gen_ai.request.model']).toBe('x');
    expect(toolCall.attributes?.['tool.name']).toBe('t');
  });

  it('traceSync 子 span 也挂父链（普通 async fn）', async () => {
    exporter.reset();
    await drain(
      traceGen('outer', {}, async function* () {
        yield 1;
        await traceSync('inner-sync', { k: 'v' }, async () => 'done');
        yield 2;
      }),
    );
    const spans = exporter.getFinishedSpans();
    const outer = spans.find(s => s.name === 'outer')!;
    const inner = spans.find(s => s.name === 'inner-sync')!;
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    expect(inner.attributes?.['k']).toBe('v');
  });

  it('traceGen 异常标记 span 并上抛', async () => {
    exporter.reset();
    await expect(
      drain(
        traceGen('err.run', {}, async function* () {
          yield 'x';
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');
    const span = exporter.getFinishedSpans().find(s => s.name === 'err.run')!;
    expect(span.events.find(e => e.name === 'exception')).toBeDefined();
    expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
  });
});
