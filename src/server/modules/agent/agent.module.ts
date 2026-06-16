import { container, Lifecycle } from 'tsyringe';
import { CACHE_SERVICE } from './agent.di-tokens';
import { CacheService } from '@/server/modules/memory/application/cache.service';

container.register(CACHE_SERVICE, CacheService, {
  lifecycle: Lifecycle.Singleton,
});

import '@/server/modules/memory/memory.module';
import './handlers';
