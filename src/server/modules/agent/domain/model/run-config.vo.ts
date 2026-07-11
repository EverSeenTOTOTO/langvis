/**
 * RunConfigVO — 运行时配置不可变快照（AgentService.createRunConfig 校验后产出）。
 * contextSize 不在此——模型派生值，由消费者经 providerService.resolveChatModel 按需取。
 */

import type { ConversationConfig } from '@/server/libs/config';

export interface RunConfigVOProps {
  systemPrompt: string;
  tools: string[];
  runtimeConfig: ConversationConfig;
}

export class RunConfigVO {
  readonly systemPrompt: string;
  readonly tools: string[];
  readonly runtimeConfig: ConversationConfig;

  private constructor(props: RunConfigVOProps) {
    this.systemPrompt = props.systemPrompt;
    this.tools = props.tools;
    this.runtimeConfig = props.runtimeConfig;
    Object.freeze(this);
  }

  static of(props: RunConfigVOProps): RunConfigVO {
    return new RunConfigVO(props);
  }
}
