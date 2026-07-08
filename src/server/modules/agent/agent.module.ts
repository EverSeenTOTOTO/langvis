import { container, Lifecycle } from 'tsyringe';
import { isProd } from '@/server/utils';
import {
  AGENT_RUN_REPOSITORY,
  CACHE_PORT,
  SANDBOX_BACKEND,
} from './agent.di-tokens';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';
import { CacheProvider } from './infrastructure/cache.provider';
import {
  DirectBash,
  DockerBash,
  type BashBackend,
} from './implementations/tools/Bash/bash-backend';

container.register(AGENT_RUN_REPOSITORY, AgentRunRepository, {
  lifecycle: Lifecycle.Singleton,
});

// CachePort 实现回归端口所有者（agent）；消费者按 CACHE_PORT 注入。
container.register(CACHE_PORT, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});

// Bash 执行后端：prod 走 Docker 沙箱，dev 直连 host。BashTool 按 SANDBOX_BACKEND 注入。
const BashBackendClass: new () => BashBackend = isProd
  ? DockerBash
  : DirectBash;
container.register(SANDBOX_BACKEND, BashBackendClass, {
  lifecycle: Lifecycle.Singleton,
});

import './application/event/agent-run.handler';
import './application/event/cancel-run.handler';
import './application/query/get-run-view.handler';
// config fragment 自注册——基础库不反向认识任何域。
import './application/service/model-config.fragment';
import './domain/model/loop-config.fragment';
