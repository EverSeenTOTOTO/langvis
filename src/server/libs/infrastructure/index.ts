import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { TRANSACTION_PORT } from '@/server/libs/ports/transaction/transaction.port';
import { LlmProvider } from './llm.provider';
import { DatabaseService } from './database.service';
import './vector-index-initializer';

// 基础设施适配器绑定：只收跨 BC 共享的端口→实现 token 绑定（业务 BC 的归各 *.module.ts）。@service 类由 tsyringe 自动注册到类 token。
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});

// TRANSACTION_PORT 复用已注册为 singleton 的 DatabaseService（transaction() 经 ALS 暴露事务边界）。
container.register(TRANSACTION_PORT, { useToken: DatabaseService });
