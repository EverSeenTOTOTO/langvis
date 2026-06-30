import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { LlmProvider } from './llm.provider';

/**
 * 内核端口由内核基础设施实现；消费方仍按 LLM_PORT token 注入。
 * 由 src/server/index.ts 加载（副作用 import）。
 */
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
