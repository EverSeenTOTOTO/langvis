import type { JSONSchemaType } from 'ajv';
import type { ComposeConfig } from './config-fragment';
import { CONTEXT_FRAGMENT } from '@/server/shared/context';
import { MODEL_FRAGMENT } from './fragments/model';
import { GUARD_FRAGMENT } from './fragments/guard';
import { APPROVAL_FRAGMENT } from './fragments/approval';

const FRAGMENTS = [
  MODEL_FRAGMENT,
  CONTEXT_FRAGMENT,
  GUARD_FRAGMENT,
  APPROVAL_FRAGMENT,
] as const;

export type ConversationConfig = ComposeConfig<typeof FRAGMENTS>;

export const configSchema = {
  type: 'object',
  properties: Object.fromEntries(FRAGMENTS.map(f => [f.key, f.schema])),
} as unknown as JSONSchemaType<unknown>;
