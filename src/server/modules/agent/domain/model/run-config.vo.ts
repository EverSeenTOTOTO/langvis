// RunConfigVO — 运行时配置不可变快照（createRunConfig 校验后产出）。contextSize 由消费者按需派生。

import type { ConversationConfig } from '@/server/libs/config';

export interface RunConfigVOProps {
  tools: string[];
  runtimeConfig: ConversationConfig;
}

export class RunConfigVO {
  readonly tools: string[];
  readonly runtimeConfig: ConversationConfig;

  private constructor(props: RunConfigVOProps) {
    this.tools = props.tools;
    this.runtimeConfig = props.runtimeConfig;
    Object.freeze(this);
  }

  static of(props: RunConfigVOProps): RunConfigVO {
    return new RunConfigVO(props);
  }
}
