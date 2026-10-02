import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseService } from './database/database.service';
import { AuthService } from '../modules/user/infrastructure/auth.service';
import { LlmProvider } from './llm/llm.provider';
import { ModelRegistryService } from './model-registry.service';
import { WorkspaceService } from './workspace/workspace.service';
import { WorkspaceLocalStore } from './workspace/workspace-local-store';
import { TerminalServer } from '../terminal/terminal.server';
import { SsrMountService } from '../middleware/ssr-mount.service';
import { VectorIndexInitializer } from './database/vector-index-initializer';
import { TRANSACTION_PORT } from './database/transaction.port';
import { LLM_PORT } from './llm/llm.tokens';
import { AUTH_PORT } from '../modules/user/user.di-tokens';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { AuthGuard } from '../guards/auth.guard';

// 基础设施模块（全局）：跨 BC 端口绑定 + 全局 filter/guard。providers 声明序即
// onModuleInit 序（DB 最先）；AppModule 中本模块排首位 → 关停时 DB 池最后关。
@Global()
@Module({
  providers: [
    DatabaseService,
    { provide: TRANSACTION_PORT, useExisting: DatabaseService },
    VectorIndexInitializer,
    AuthService,
    { provide: AUTH_PORT, useExisting: AuthService },
    LlmProvider,
    { provide: LLM_PORT, useExisting: LlmProvider },
    ModelRegistryService,
    WorkspaceLocalStore,
    WorkspaceService,
    TerminalServer,
    SsrMountService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    DatabaseService,
    TRANSACTION_PORT,
    AUTH_PORT,
    LLM_PORT,
    ModelRegistryService,
    WorkspaceService,
    WorkspaceLocalStore,
    AuthService,
    TerminalServer,
    SsrMountService,
  ],
})
export class InfraModule {}
