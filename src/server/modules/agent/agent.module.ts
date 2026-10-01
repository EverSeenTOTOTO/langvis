import { Module, Scope, type InjectionToken } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { HumanInputController } from './human-input.controller';
import { AgentController } from './agent.controller';
import { SttController } from './stt.controller';
import { AgentRunHandler } from './application/event/agent-run.handler';
import { CancelRunHandler } from './application/event/cancel-run.handler';
import { AgentRunExecutor } from './application/service/agent-run-executor';
import { AgentService } from './application/service/agent.service';
import { SkillService } from './application/service/skill.service';
import { ToolService } from './application/service/tool.service';
import { HOOK_TYPES } from './application/hooks/registry';
import { createTool, toolIdOf } from './application/tools/register-tool';
import { TOOL_REGISTRY } from './implementations/tools/registry';
import { ToolIds } from '@/shared/constants';
import {
  AGENT_RUN_REPOSITORY,
  CACHE_PORT,
  AUTHORIZATION_PORT,
} from './agent.di-tokens';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';
import { CacheProvider } from './infrastructure/cache.provider';
import { AuthorizationProvider } from './infrastructure/authorization.provider';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';

// 工具构造依赖接线表（createTool 经 useFactory 定参注入，esbuild 无 paramtypes 故显式）
const TOOL_DEPS: Partial<Record<string, InjectionToken[]>> = {
  [ToolIds.CALL_SUBAGENTS]: [AgentRunExecutor, AgentService],
  [ToolIds.SKILL_CALL]: [SkillService],
  [ToolIds.LIST_TOOLS]: [ToolService, SkillService],
  [ToolIds.DOCUMENT_SEARCH]: [DatabaseService, ToolService],
  [ToolIds.DOCUMENT_STORE]: [DatabaseService, WorkspaceService, ToolService],
  [ToolIds.FILE_EDIT]: [WorkspaceService, ToolService],
  [ToolIds.DOCUMENT_METADATA_EXTRACT]: [WorkspaceService],
};

@Module({
  imports: [CqrsModule],
  controllers: [HumanInputController, AgentController, SttController],
  providers: [
    AgentRunRepository,
    { provide: AGENT_RUN_REPOSITORY, useExisting: AgentRunRepository },
    CacheProvider,
    { provide: CACHE_PORT, useExisting: CacheProvider },
    AuthorizationProvider,
    { provide: AUTHORIZATION_PORT, useExisting: AuthorizationProvider },
    SkillService,
    ToolService,
    AgentService,
    AgentRunExecutor,
    // per-run 瞬态：executor 经 ModuleRef 每次 get 新建（跨 tick 私有状态内聚实例字段）
    ...HOOK_TYPES.map(T => ({
      provide: T,
      useClass: T,
      scope: Scope.TRANSIENT,
    })),
    // 工具实例：静态 registry 生成 string-token providers（LLM 运行期按 id 寻址）
    ...TOOL_REGISTRY.map(({ clazz, config }) => {
      const deps = TOOL_DEPS[toolIdOf(clazz)] ?? [];
      return {
        provide: toolIdOf(clazz),
        useFactory: (...resolved: unknown[]) =>
          createTool(clazz, config, resolved),
        inject: deps,
      };
    }),
    AgentRunHandler,
    CancelRunHandler,
  ],
  exports: [AGENT_RUN_REPOSITORY, ToolService, SkillService, AgentService],
})
export class AgentModule {}
