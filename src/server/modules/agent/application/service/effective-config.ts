import type { AgentConfig } from '@/shared/types';
import type { AgentBinding, EffectiveConfig } from '@/shared/types/agent';
import type { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { parse } from '@/server/utils/schemaValidator';
import { ConfigValidationError } from '../../domain/errors';

/**
 * 合并 AgentConfig（模板 schema）与 AgentBinding.config（用户配置）为不可变运行时快照。
 * 验证时机：创建 AgentRun 时（比旧的 proxyValidation 更早发现问题）。
 */
export function resolveEffectiveConfig(
  agentConfig: AgentConfig,
  binding: AgentBinding,
  providerService: ProviderService,
  systemPrompt: string,
): EffectiveConfig {
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

  const modelId = (runtimeConfig as { model?: { modelId?: string } }).model
    ?.modelId;
  const model = modelId ? providerService.getModel(modelId) : undefined;

  return {
    agentId: binding.agentId,
    agentName: agentConfig.name,
    systemPrompt,
    tools: agentConfig.tools ?? [],
    contextSize: model?.contextSize ?? 128_000,
    runtimeConfig,
  };
}
