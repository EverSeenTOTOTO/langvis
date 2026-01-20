import {
  ConfigValidationError,
  validateConfig,
} from '@/server/utils/configValidation';
import { ConfigItem } from '@/shared/types';
import { describe, expect, it } from 'vitest';

describe('validateConfig', () => {
  it('should return input as is if no schema provided', () => {
    const input = { foo: 'bar' };
    expect(validateConfig(undefined, input)).toEqual(input);
  });

  it('should populate initialValue for missing optional fields', () => {
    const schema: Record<string, ConfigItem> = {
      foo: { type: 'text', initialValue: 'default' },
    };
    expect(validateConfig(schema, {})).toEqual({ foo: 'default' });
  });

  it('should throw error for missing required fields', () => {
    const schema: Record<string, ConfigItem> = {
      foo: { type: 'text', required: true },
    };
    expect(() => validateConfig(schema, {})).toThrow(ConfigValidationError);
    expect(() => validateConfig(schema, {})).toThrow('foo: Field is required');
  });

  it('should validate text type', () => {
    const schema: Record<string, ConfigItem> = {
      foo: { type: 'text' },
    };
    expect(validateConfig(schema, { foo: 'bar' })).toEqual({ foo: 'bar' });
    expect(() => validateConfig(schema, { foo: 123 })).toThrow(
      'foo: Expected string',
    );
  });

  it('should validate number type and coerce strings', () => {
    const schema: Record<string, ConfigItem> = {
      val: { type: 'number', min: 0, max: 10 },
    };
    expect(validateConfig(schema, { val: 5 })).toEqual({ val: 5 });
    expect(validateConfig(schema, { val: '5' })).toEqual({ val: 5 });
    expect(() => validateConfig(schema, { val: 'abc' })).toThrow(
      'val: Expected number',
    );
    expect(() => validateConfig(schema, { val: -1 })).toThrow(
      'val: Value must be >= 0',
    );
    expect(() => validateConfig(schema, { val: 11 })).toThrow(
      'val: Value must be <= 10',
    );
  });

  it('should validate boolean (switch) type', () => {
    const schema: Record<string, ConfigItem> = {
      enabled: { type: 'switch' },
    };
    expect(validateConfig(schema, { enabled: true })).toEqual({
      enabled: true,
    });
    expect(validateConfig(schema, { enabled: 'true' })).toEqual({
      enabled: true,
    });
    expect(validateConfig(schema, { enabled: 'false' })).toEqual({
      enabled: false,
    });
    expect(() => validateConfig(schema, { enabled: 'not-bool' })).toThrow(
      'enabled: Expected boolean',
    );
  });

  it('should validate select options', () => {
    const schema: Record<string, ConfigItem> = {
      choice: {
        type: 'select',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
    };
    expect(validateConfig(schema, { choice: 'a' })).toEqual({ choice: 'a' });
    expect(() => validateConfig(schema, { choice: 'c' })).toThrow(
      'choice: Invalid option: c',
    );
  });

  it('should validate primitive options', () => {
    const schema: Record<string, ConfigItem> = {
      choice: {
        type: 'select',
        // @ts-expect-error test primitive options
        options: ['a', 'b'],
      },
    };
    expect(validateConfig(schema, { choice: 'a' })).toEqual({ choice: 'a' });
    expect(() => validateConfig(schema, { choice: 'c' })).toThrow(
      'choice: Invalid option: c',
    );
  });

  it('should validate multiple select', () => {
    const schema: Record<string, ConfigItem> = {
      tags: {
        type: 'select',
        mode: 'multiple',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
    };
    expect(validateConfig(schema, { tags: ['a', 'b'] })).toEqual({
      tags: ['a', 'b'],
    });
    expect(() => validateConfig(schema, { tags: 'a' })).toThrow(
      'tags: Expected array',
    );
    expect(() => validateConfig(schema, { tags: ['a', 'c'] })).toThrow(
      'tags: Invalid option: c',
    );
  });

  it('should validate checkbox-group', () => {
    const schema: Record<string, ConfigItem> = {
      tags: {
        type: 'checkbox-group',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
    };
    expect(validateConfig(schema, { tags: ['a'] })).toEqual({ tags: ['a'] });
    expect(() => validateConfig(schema, { tags: 'a' })).toThrow(
      'tags: Expected array',
    );
    expect(() => validateConfig(schema, { tags: ['c'] })).toThrow(
      'tags: Invalid option: c',
    );
  });

  it('should validate recursive group', () => {
    const schema: Record<string, ConfigItem> = {
      settings: {
        type: 'group',
        label: { en: 'Settings' },
        children: {
          theme: { type: 'text', required: true },
          nested: {
            type: 'group',
            label: { en: 'Nested' },
            children: {
              val: { type: 'number' },
            },
          },
        },
      },
    };

    expect(
      validateConfig(schema, {
        settings: {
          theme: 'dark',
          nested: { val: 1 },
        },
      }),
    ).toEqual({
      settings: {
        theme: 'dark',
        nested: { val: 1 },
      },
    });

    expect(() =>
      validateConfig(schema, {
        settings: { theme: 'dark', nested: { val: 'abc' } },
      }),
    ).toThrow('settings.nested.val: Expected number');

    expect(() => validateConfig(schema, { settings: {} })).toThrow(
      'settings.theme: Field is required',
    );
  });
});
