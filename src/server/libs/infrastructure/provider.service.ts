import path from 'path';
import fs from 'fs';
import logger from '@/server/utils/logger';
import type {
  GroupedModels,
  ModelDefinition,
  ModelType,
  ProviderDefinition,
} from '@/shared/types/provider';
import { service } from '@/server/decorator/service';
import chalk from 'chalk';

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function resolveEnvVars(value: string): string {
  return value.replace(ENV_VAR_RE, (_, varName) => {
    const envVal = process.env[varName];
    if (envVal === undefined) {
      logger.warn(`Environment variable ${varName} not set`);
      return '';
    }
    return envVal;
  });
}

@service()
export class ProviderService {
  private providers: Map<string, ProviderDefinition> = new Map();
  private models: Map<string, ModelDefinition> = new Map();

  constructor() {
    const configPath = path.resolve(process.cwd(), 'config', 'providers.json');

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const providers: ProviderDefinition[] = JSON.parse(raw);

      this.providers.clear();
      this.models.clear();

      for (const provider of providers) {
        const resolved: ProviderDefinition = {
          ...provider,
          baseUrl: resolveEnvVars(provider.baseUrl),
          apiKey: resolveEnvVars(provider.apiKey),
        };

        this.providers.set(resolved.id, resolved);

        for (const model of resolved.models) {
          const fullId = `${resolved.id}:${model.id}`;
          if (this.models.has(fullId)) {
            logger.warn(`Duplicate model id: ${fullId}`);
          }
          this.models.set(fullId, { ...model, id: fullId });
        }

        logger.info(
          `Loaded provider: ${chalk.yellow(resolved.name)} (${resolved.models.length} models)`,
        );
      }

      logger.info(
        `Total: ${this.providers.size} providers, ${this.models.size} models`,
      );
    } catch (error) {
      logger.error(`Failed to load providers config: ${error}`);
      throw error;
    }
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  getDefaultModel(type: ModelType): ModelDefinition | undefined {
    let fallback: ModelDefinition | undefined;
    for (const model of this.models.values()) {
      if (model.type !== type) continue;
      if (model.primary) return model;
      if (!fallback) fallback = model;
    }
    return fallback;
  }

  /**
   * 解析实际使用的 chat 模型：优先显式 modelId（命中即用，含 stale id 回退），否则回退默认 chat 模型。
   * 统一「无 model 配置」时 conversation 侧与 agent 侧的口径——避免一边回退 0、一边回退硬编码 128k
   * 的不一致。id 供 LLM 调用（undefined 时由 provider 自取默认），contextSize 供用量与压缩阈值。
   */
  resolveChatModel(modelId?: string): {
    id: string | undefined;
    contextSize: number;
  } {
    if (modelId) {
      const m = this.getModel(modelId);
      if (m) return { id: m.id, contextSize: m.contextSize ?? 0 };
    }
    const fallback = this.getDefaultModel('chat');
    return { id: fallback?.id, contextSize: fallback?.contextSize ?? 0 };
  }

  /** 从 runtimeConfig 派生模型上下文窗口（model.modelId → resolveChatModel）；无 model 走默认。 */
  resolveContextSize(runtimeConfig: Record<string, unknown>): number {
    const modelId = (
      runtimeConfig as { model?: { modelId?: string } } | undefined
    )?.model?.modelId;
    return this.resolveChatModel(modelId).contextSize;
  }

  getModelsByType(type: ModelType): ModelDefinition[] {
    const result: ModelDefinition[] = [];
    for (const model of this.models.values()) {
      if (model.type === type) {
        result.push(model);
      }
    }
    return result;
  }

  getGroupedModelsByType(type: ModelType): GroupedModels[] {
    const grouped = new Map<string, GroupedModels>();

    for (const model of this.models.values()) {
      if (model.type !== type) continue;

      const [providerId] = model.id.split(':');
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      if (!grouped.has(providerId)) {
        grouped.set(providerId, {
          providerId,
          providerName: provider.name,
          models: [],
        });
      }

      grouped.get(providerId)!.models.push({
        id: model.id,
        name: model.name,
        multimodal: model.multimodal,
        contextSize: model.contextSize,
      });
    }

    return Array.from(grouped.values());
  }
}
