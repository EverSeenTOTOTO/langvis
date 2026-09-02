import dotenv from 'dotenv';
import nodePath from 'node:path';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';

// 必须先于 initTracing()——OTLP endpoint/headers 来自 .env，而 index.ts 的 dotenv.config()
// 在模块体（所有 import 之后）才跑，此时 tracing 已 import 完。此处显式加载保 env 就位。
dotenv.config({
  path:
    process.env.NODE_ENV === 'production'
      ? nodePath.resolve(process.cwd(), '.env')
      : nodePath.resolve(process.cwd(), '.env.development'),
  override: true,
});

// AsyncLocalStorageContextManager 跨 await 传播 context（Node/Bun 通用，显式指定保一致）。
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// OTel SDK 启动——env 驱动，业务零耦合；无 endpoint 或测试环境跳过。index.ts 最前面 import
// 本文件保插桩 require-hook 先于业务 import（Node ESM→CJS interop 保留 require 链）。
let started: NodeSDK | undefined;

function initTracing(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  started = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'langvis',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? 'unknown',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    contextManager: new AsyncLocalStorageContextManager(),
    // 显式装本栈用得上的插桩（fs/dns 噪音大不装）：http=server span+http 指标、express=中间件层
    // span、winston=日志关联+OTLP transport、runtime-node=eventloop/heap 指标、pg/net=db/tcp span。
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new WinstonInstrumentation(),
      new RuntimeNodeInstrumentation(),
      new PgInstrumentation(),
      new NetInstrumentation(),
    ],
  });
  started.start();
}

initTracing();

export async function shutdownTracing(): Promise<void> {
  if (started) await started.shutdown();
}
