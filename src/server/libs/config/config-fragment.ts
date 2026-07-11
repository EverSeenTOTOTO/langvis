import type { JSONSchemaType } from 'ajv';

export interface ConfigFragment<K extends string = string, T = unknown> {
  key: K;
  schema: JSONSchemaType<unknown>;
  _?: T;
}

export type ComposeConfig<
  Fragments extends readonly ConfigFragment<string, unknown>[],
> = {
  [F in Fragments[number] as F extends ConfigFragment<infer K, unknown>
    ? K
    : never]?: F extends ConfigFragment<string, infer V> ? V : never;
};
