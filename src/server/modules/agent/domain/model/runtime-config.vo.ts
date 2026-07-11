/**
 * RuntimeConfigVO — 运行时配置不可变快照（AgentService.createRunConfig 校验后产出）。
 * contextSize 不在此——模型派生值，由消费者经 providerService.resolveChatModel 按需取。
 */

export interface RuntimeConfigVOProps {
  systemPrompt: string;
  tools: string[];
  runtimeConfig: Record<string, unknown>;
}

export class RuntimeConfigVO {
  readonly systemPrompt: string;
  readonly tools: string[];
  readonly runtimeConfig: Record<string, unknown>;

  private constructor(props: RuntimeConfigVOProps) {
    this.systemPrompt = props.systemPrompt;
    this.tools = props.tools;
    this.runtimeConfig = props.runtimeConfig;
    Object.freeze(this);
  }

  static of(props: RuntimeConfigVOProps): RuntimeConfigVO {
    return new RuntimeConfigVO(props);
  }
}
