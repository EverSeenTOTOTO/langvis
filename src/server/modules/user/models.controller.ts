import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { ModelType } from '@/shared/types/provider';
import { ProviderService } from '@/server/shared/infrastructure/provider.service';

// 模型目录（providers.json 聚合）——设置页模型选择数据源。
@Controller('models')
export class ModelsController {
  constructor(
    @Inject(ProviderService) private providerService: ProviderService,
  ) {}

  @Get()
  getModels(@Query() q?: { type?: string }) {
    const modelType = (q?.type ?? 'chat') as ModelType;
    return this.providerService.getGroupedModelsByType(modelType);
  }
}
