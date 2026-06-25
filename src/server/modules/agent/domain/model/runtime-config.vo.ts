/**
 * RuntimeConfigVO — 运行时配置值对象（纯值，不可变快照）。
 *
 * 由 AgentService.createRunConfig 构造（校验 userConfig 后产出）。
 * 不再持有 agentId/agentName（单一 agent 后为死字段）。
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

  /** 由 AgentService 在校验通过后构造。 */
  static of(props: RuntimeConfigVOProps): RuntimeConfigVO {
    return new RuntimeConfigVO(props);
  }
}
