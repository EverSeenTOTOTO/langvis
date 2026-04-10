import type { Response } from 'express';
import type { ModelType } from '@/shared/types/provider';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { query, response } from '../decorator/param';
import { ProviderService } from '../service/ProviderService';

@controller('/api/models')
export default class ModelController {
  constructor(
    @inject(ProviderService) private providerService?: ProviderService,
  ) {}

  @api('/')
  getModels(@query() q?: { type?: string }, @response() res?: Response) {
    const modelType = (q?.type ?? 'chat') as ModelType;
    return res!.json(this.providerService!.getGroupedModelsByType(modelType));
  }
}
