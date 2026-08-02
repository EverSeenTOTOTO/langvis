import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { LlmProvider } from './llm.provider';

// 基础设施适配器绑定：只收跨 BC 共享的端口→实现 token 绑定（业务 BC 的归各 *.module.ts）。@service 类由 tsyringe 自动注册到类 token。
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
