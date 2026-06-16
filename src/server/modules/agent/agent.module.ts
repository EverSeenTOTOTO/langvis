import { container, Lifecycle } from 'tsyringe';
import { CACHE_SERVICE } from './agent.di-tokens';
import { CacheProvider } from '@/server/modules/memory/infrastructure/cache.provider';

container.register(CACHE_SERVICE, CacheProvider, {
  lifecycle: Lifecycle.Singleton,
});

import '@/server/modules/memory/memory.module';
import './application/event/agent-run.handler';
import './application/event/turn-cancellation.handler';
