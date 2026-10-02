import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { ModelType } from '@/shared/types/provider';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';

// 模型目录（providers.json 聚合）——设置页模型选择数据源。
@Controller('models')
export class ModelsController {
  constructor(
    @Inject(ModelRegistryService) private modelRegistry: ModelRegistryService,
  ) {}

  @Get()
  getModels(@Query() q?: { type?: string }) {
    const modelType = (q?.type ?? 'chat') as ModelType;
    return this.modelRegistry.getGroupedModelsByType(modelType);
  }
}
