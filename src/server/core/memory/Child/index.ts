import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { Memory } from '..';

@memory(MemoryIds.CHILD)
export default class ChildMemory extends Memory {}
