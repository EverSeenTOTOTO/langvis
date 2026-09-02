import dotenv from 'dotenv';
import nodePath from 'node:path';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
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

// Bun 上 AsyncHooksContextManager（基于 asyncHooks.createHook）跨 await 丢 context，子 span 成孤儿；
// AsyncLocalStorageContextManager 基于 AsyncLocalStorage，Bun 正确传播跨 await。显式指定保运行时一致。
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// OTel SDK 启动——env 驱动，业务零耦合；无 endpoint 或测试环境跳过。
// 在 index.ts 最前面 import，保证 auto-instrumentation 先于业务 import patch。
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
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // Bun 未实现 v8.getHeapSpaceStatistics，runtime-node 采集器每次抓取抛 ERR_NOT_IMPLEMENTED。
        '@opentelemetry/instrumentation-runtime-node': { enabled: false },
      }),
    ],
  });
  started.start();
}

initTracing();

export async function shutdownTracing(): Promise<void> {
  if (started) await started.shutdown();
}
