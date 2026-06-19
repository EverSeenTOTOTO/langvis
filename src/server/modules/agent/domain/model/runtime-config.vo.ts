import type { AgentBinding, AgentConfig } from '@/shared/types';
import { parse } from '@/server/utils/schemaValidator';
import { ConfigValidationError } from '../errors';

/**
 * RuntimeConfigVO — 运行时配置值对象。
 *
 * AgentRun 创建时合并 AgentConfig + AgentBinding 的不可变快照。
 * 通过 create() 工厂方法封装验证规则，保证非法配置无法构造。
 */

export interface RuntimeConfigVOProps {
  agentId: string;
  agentName: string;
  systemPrompt: string;
  tools: string[];
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

export class RuntimeConfigVO {
  readonly agentId: string;
  readonly agentName: string;
  readonly systemPrompt: string;
  readonly tools: string[];
  readonly contextSize: number;
  readonly runtimeConfig: Record<string, unknown>;

  private constructor(props: RuntimeConfigVOProps) {
    this.agentId = props.agentId;
    this.agentName = props.agentName;
    this.systemPrompt = props.systemPrompt;
    this.tools = props.tools;
    this.contextSize = props.contextSize;
    this.runtimeConfig = props.runtimeConfig;
    Object.freeze(this);
  }

  /** 工厂方法：configSchema 验证 + 合并为不可变快照 */
  static create(
    agentConfig: AgentConfig,
    binding: AgentBinding,
    systemPrompt: string,
    contextSize: number,
  ): RuntimeConfigVO {
    let runtimeConfig: Record<string, unknown>;

    try {
      runtimeConfig = agentConfig.configSchema
        ? parse(agentConfig.configSchema, binding.config)
        : { ...binding.config };
    } catch (e) {
      throw new ConfigValidationError(
        binding.agentId,
        (e as Error)?.message ?? String(e),
      );
    }

    return new RuntimeConfigVO({
      agentId: binding.agentId,
      agentName: agentConfig.name,
      systemPrompt,
      tools: agentConfig.tools ?? [],
      contextSize,
      runtimeConfig,
    });
  }
}
