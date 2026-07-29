/**
 * LLM_PORT —— LlmPort（内核契约）的 DI token。
 * 注册到 LlmProvider（singleton）；消费方按 token 注入，不依赖具体实现类。
 */
export const LLM_PORT = Symbol('LLM_PORT');
