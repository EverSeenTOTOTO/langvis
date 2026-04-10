import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';
import type {
  GroupedModels,
  ModelDefinition,
  ModelType,
  ProviderDefinition,
} from '@/shared/types/provider';
import { service } from '../decorator/service';
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

  /** Get the first model of a given type as default */
  getDefaultModel(type: ModelType): ModelDefinition | undefined {
    for (const model of this.models.values()) {
      if (model.type === type) return model;
    }
    return undefined;
  }

  /** Get all models of a given type, flat list */
  getModelsByType(type: ModelType): ModelDefinition[] {
    const result: ModelDefinition[] = [];
    for (const model of this.models.values()) {
      if (model.type === type) {
        result.push(model);
      }
    }
    return result;
  }

  /** Get models grouped by provider for TreeSelect */
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
      });
    }

    return Array.from(grouped.values());
  }
}
