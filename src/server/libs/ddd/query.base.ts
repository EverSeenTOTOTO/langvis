import { generateId } from '@/shared/utils';

/**
 * Query — pure data structure for read-side requests.
 */
export abstract class Query {
  readonly id = generateId('qry');
  readonly createdAt = new Date();
}
