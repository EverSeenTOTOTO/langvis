import { container, Lifecycle } from 'tsyringe';
import { AGENT_RUN_REPOSITORY } from './agent.di-tokens';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';

container.register(AGENT_RUN_REPOSITORY, AgentRunRepository, {
  lifecycle: Lifecycle.Singleton,
});

import './application/event/agent-run.handler';
import './application/event/cancel-run.handler';
// 本域 config fragment 自注册（defineConfigFragment）——基础库不反向认识任何域。
import './application/service/model-config.fragment';
