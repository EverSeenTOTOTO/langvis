import { container, Lifecycle } from 'tsyringe';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { LlmProvider } from './llm.provider';

/**
 * 基础设施适配器绑定 —— composition root 的「共享内核 / infra」接线。
 *
 * 业务 BC 各自的端口→实现绑定归各 *.module.ts（agent / conversation…）；此处只放
 * 跨 BC 共享、不属任一 BC 的端口绑定。消费方仍按端口 token 注入，不认识 infra 实现。
 * 由 src/server/index.ts 一次性副作用导入触发。
 *
 * 注：libs/infrastructure 下的 @service 类（workspace / redis / database / …）由 tsyringe
 * 自动注册到自身类 token，无需在此声明——本文件只收命令式 token 绑定。
 */
container.register(LLM_PORT, LlmProvider, {
  lifecycle: Lifecycle.Singleton,
});
