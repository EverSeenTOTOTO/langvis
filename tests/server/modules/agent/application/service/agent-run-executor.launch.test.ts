import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentRunExecutor,
  type LaunchParams,
} from '@/server/modules/agent/application/service/agent-run-executor';
import { serializeAction } from '@/server/modules/agent/application/service/react-message';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { AgentRunConcurrentModificationError } from '@/server/modules/agent/domain/errors';
import { ToolIds } from '@/shared/constants';
import type { Logger } from '@/server/utils/logger';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import type { LlmPort } from '@/server/infrastructure/llm/llm.port';
import type { AgentService } from '@/server/modules/agent/application/service/agent.service';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';
import type { ToolConfig } from '@/shared/types';

import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';

/** 无操作 hook：防止 resolveAll 因未注册 token 而抛。 */
class NoopHook implements Hook {
  readonly id = 'noop';
  readonly phase: HookPhase = 'pre-llm';
  apply(): AsyncGenerator<RunEvent, void> {
    return (async function* () {})();
  }
}

class StubResponseUserTool extends Tool<{ delivered: boolean }> {
  readonly id = ToolIds.RESPONSE_USER;
  readonly config = {} as ToolConfig;
  protected readonly logger: Logger = {} as Logger;

  async *call(): AsyncGenerator<RunEvent, { delivered: boolean }, void> {
    yield {
      type: 'tool_progress',
      callId: 'tc_stub',
      data: { status: 'running' },
    };
    return { delivered: true };
  }
}

/** 复刻 TypeORM @Version 的 commit：首次调用抛冲突，之后从"最新版本"成功。 */
function makeRepoMock() {
  const committed: Array<{ events: EnrichedEvent[]; status: string }> = [];
  const checkpoints: EnrichedEvent[][] = [];
  let commitCalls = 0;
  const repo = {
    save: async (run: unknown) => run,
    commit: async (
      runId: string,
      payload: { events: EnrichedEvent[]; status: string },
    ) => {
      commitCalls++;
      if (commitCalls === 1) {
        throw new AgentRunConcurrentModificationError(runId);
      }
      committed.push(payload);
      return { id: runId, ...payload };
    },
    checkpoint: async (runId: string, events: EnrichedEvent[]) => {
      checkpoints.push(events);
      return { id: runId, events };
    },
    update: async () => null,
    findById: async () => null,
    findByIds: async () => [],
    findNonTerminal: async () => [],
  } as unknown as AgentRunRepositoryPort;
  return { repo, committed, checkpoints, commitCallsRef: () => commitCalls };
}

const responseXml = serializeAction({
  tool: ToolIds.RESPONSE_USER,
  input: { message: 'hello' },
});
const llmMock: Pick<LlmPort, 'chat' | 'chatContent'> = {
  chat: () =>
    (async function* () {
      yield responseXml;
      return responseXml;
    })(),
  chatContent: async () => responseXml,
};
const cacheMock = {} as CachePort;
const authMock = {} as AuthorizationPort;
const agentServiceStub = {
  buildResolvedRunConfig: (
    runtimeConfig: Parameters<AgentService['buildResolvedRunConfig']>[0],
  ) => RunConfigVO.of({ tools: [], runtimeConfig }),
} as unknown as AgentService;

const params: LaunchParams = {
  runId: 'run_exec_test',
  workDir: '/tmp/langvis-test',
  conversationId: 'conv_exec_test',
  runtimeConfig: { model: { modelId: 'test-model' } },
  seed: [],
  toolSet: ToolSet.of([{ id: ToolIds.RESPONSE_USER, mode: 'inline' }]),
  interactive: true,
};

describe('AgentRunExecutor.launch — 终态写冲突重试', () => {
  // ModuleRef stub：hook 全走 NoopHook、RESPONSE_USER 工具走 Stub（原容器注册语义）
  const moduleRef = {
    get: (token: unknown) => {
      if (token === ToolIds.RESPONSE_USER) return new StubResponseUserTool();
      return new NoopHook();
    },
    resolve: async (T: new () => NoopHook) => new T(),
  };
  beforeEach(() => {
    // NoopHook/Stub 经 moduleRef.get 按次构造
  });

  it('commit 首次冲突时重试并成功，最终落库含全部事件 + 终态 status', async () => {
    const { repo, committed, commitCallsRef } = makeRepoMock();
    const executor = new AgentRunExecutor(
      llmMock as unknown as LlmPort,
      cacheMock,
      authMock,
      repo,
      agentServiceStub,
      moduleRef as never,
    );

    const events: EnrichedEvent[] = [];
    for await (const event of executor.launch(params)) {
      events.push(event);
    }

    expect(commitCallsRef()).toBe(2);
    expect(committed).toHaveLength(1);
    expect(committed[0].status).toBe('completed');
    expect(committed[0].events.some(e => e.type === 'final')).toBe(true);
  });

  it('checkpointEvery=1 时每事件都中途落库快照，终态仍含 final', async () => {
    const { repo, checkpoints } = makeRepoMock();
    const executor = new AgentRunExecutor(
      llmMock as unknown as LlmPort,
      cacheMock,
      authMock,
      repo,
      agentServiceStub,
      moduleRef as never,
    );
    executor.checkpointEvery = 1;

    for await (const _ of executor.launch(params)) {
      // drain
    }

    expect(checkpoints.length).toBeGreaterThan(1);
    // 首快照是 [start]，随 append 单调增长（快照含 start 事件）。
    expect(checkpoints[0].some(e => e.type === 'start')).toBe(true);
    // 中途快照非终态（无 final），终态仅由 commit 写入。
    for (const snap of checkpoints) {
      expect(snap.some(e => e.type === 'final')).toBe(false);
    }
  });
});
