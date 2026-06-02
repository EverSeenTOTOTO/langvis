import { generateId } from '@/shared/utils';

export abstract class Command {
  readonly id = generateId('cmd');
  readonly createdAt = new Date();
}
