import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { LlmProvider } from './llm.provider';

/**
 * 内核 LLM 装配——LlmPort（内核契约，libs/ports/llm）的 OpenAI 实现。
 *
 * 原由 memory 模块注册（用于斩断 agent→memory 的引擎耦合）；memory 解散后，内核端口
 * 由内核基础设施实现，消费方仍按 LLM_PORT token 注入。由 src/server/index.ts 加载（副作用 import）。
 */
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
