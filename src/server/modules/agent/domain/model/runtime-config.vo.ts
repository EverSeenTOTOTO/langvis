/**
 * RuntimeConfigVO — 运行时配置不可变快照（AgentService.createRunConfig 校验后产出）。
 */

export interface RuntimeConfigVOProps {
  systemPrompt: string;
  tools: string[];
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

export class RuntimeConfigVO {
  readonly systemPrompt: string;
  readonly tools: string[];
  readonly contextSize: number;
  readonly runtimeConfig: Record<string, unknown>;

  private constructor(props: RuntimeConfigVOProps) {
    this.systemPrompt = props.systemPrompt;
    this.tools = props.tools;
    this.contextSize = props.contextSize;
    this.runtimeConfig = props.runtimeConfig;
    Object.freeze(this);
  }

  static of(props: RuntimeConfigVOProps): RuntimeConfigVO {
    return new RuntimeConfigVO(props);
  }
}
