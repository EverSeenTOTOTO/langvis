import { container } from 'tsyringe';
import { MEMORY_FACTORY } from './memory.di-tokens';
import { MemoryFactory } from './application/service/memory-factory';

container.register(MEMORY_FACTORY, MemoryFactory);
