export type ModelType = 'chat' | 'embedding' | 'tts';

export interface ModelDefaults {
  temperature?: number;
  topP?: number;
  voice?: string;
  emotion?: string;
  speedRatio?: number;
}

export interface ModelDefinition {
  id: string;
  name: string;
  type: ModelType;
  contextSize?: number;
  multimodal?: boolean;
  endpoint?: string;
  defaults?: ModelDefaults;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ModelDefinition[];
}

export interface GroupedModels {
  providerId: string;
  providerName: string;
  models: { id: string; name: string; multimodal?: boolean }[];
}
