import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseService } from './shared/infrastructure/database.service';
import { AuthService } from './shared/infrastructure/auth.service';
import { LlmProvider } from './shared/infrastructure/llm.provider';
import { LocaleService } from './shared/infrastructure/locale.service';
import { ProviderService } from './shared/infrastructure/provider.service';
import { WorkspaceService } from './shared/infrastructure/workspace.service';
import { WorkspaceLocalStore } from './shared/infrastructure/workspace-local-store';
import { VectorIndexInitializer } from './shared/infrastructure/vector-index-initializer';
import { TRANSACTION_PORT } from './shared/ports/transaction/transaction.port';
import { LLM_PORT } from './shared/ports/llm/llm.tokens';
import { AUTH_PORT } from './modules/user/user.di-tokens';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { AuthGuard } from './guards/auth.guard';

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
    LocaleService,
    ProviderService,
    WorkspaceLocalStore,
    WorkspaceService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    DatabaseService,
    TRANSACTION_PORT,
    AUTH_PORT,
    LLM_PORT,
    LocaleService,
    ProviderService,
    WorkspaceService,
    WorkspaceLocalStore,
    AuthService,
  ],
})
export class InfraModule {}
