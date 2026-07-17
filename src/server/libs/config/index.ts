import type { JSONSchemaType } from 'ajv';
import type { ComposeConfig } from './config-fragment';
import { MODEL_FRAGMENT } from './fragments/model';
import { LOOP_FRAGMENT } from './fragments/loop';
import { HISTORY_FRAGMENT } from './fragments/history';
import { GUARD_FRAGMENT } from './fragments/guard';
import { OFFLOAD_FRAGMENT } from './fragments/offload';
import { AUDIT_FRAGMENT } from './fragments/audit';

const FRAGMENTS = [
  MODEL_FRAGMENT,
  LOOP_FRAGMENT,
  HISTORY_FRAGMENT,
  OFFLOAD_FRAGMENT,
  GUARD_FRAGMENT,
  AUDIT_FRAGMENT,
] as const;

export type ConversationConfig = ComposeConfig<typeof FRAGMENTS>;

export const configSchema = {
  type: 'object',
  properties: Object.fromEntries(FRAGMENTS.map(f => [f.key, f.schema])),
} as unknown as JSONSchemaType<unknown>;
