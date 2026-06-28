/**
 * LLM_PORT —— LlmPort（内核契约）的 DI token。
 * memory.module 注册 LLM_PORT → LlmProvider（singleton）；消费方按 token 注入，
 * 不再直接依赖 LlmProvider 具体类（斩断 agent → memory 的引擎耦合）。
 */
export const LLM_PORT = Symbol('LLM_PORT');
