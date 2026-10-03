import { describe, it, expect } from 'vitest';
import {
  validate,
  coerceJsonStringFields,
} from '@/server/utils/schemaValidator';

const documentSchema = {
  type: 'object',
  properties: {
    document: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['title', 'metadata'],
    },
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          index: { type: 'number' },
        },
        required: ['content', 'index'],
      },
    },
  },
  required: ['document'],
};

describe('coerceJsonStringFields', () => {
  it('顶层 object 字段的字符串双重编码被还原', () => {
    const out = coerceJsonStringFields(documentSchema, {
      document: '{"title":"t","metadata":{"a":1}}',
    });
    expect(out).toEqual({ document: { title: 't', metadata: { a: 1 } } });
  });

  it('嵌套字段双重编码被还原（document.metadata 为字符串）', () => {
    const data = {
      document: {
        title: 't',
        metadata: '{"platform":"kube.io"}',
      },
    };
    expect(validate(documentSchema as never, data).valid).toBe(false);

    const out = coerceJsonStringFields(documentSchema, data);

    expect(out).toEqual({
      document: { title: 't', metadata: { platform: 'kube.io' } },
    });
    expect(validate(documentSchema as never, out!).valid).toBe(true);
  });

  it('array-of-object 元素为字符串时逐元素还原', () => {
    const out = coerceJsonStringFields(documentSchema, {
      document: { title: 't', metadata: {} },
      chunks: ['{"content":"a","index":0}', '{"content":"b","index":1}'],
    });
    expect(out?.chunks).toEqual([
      { content: 'a', index: 0 },
      { content: 'b', index: 1 },
    ]);
  });

  it('合法输入原样返回 null（不重建对象）', () => {
    const data = {
      document: { title: 't', metadata: { platform: 'kube.io' } },
    };
    expect(coerceJsonStringFields(documentSchema, data)).toBeNull();
  });

  it('非 JSON 字符串不被强解（原样保留，交给 ajv 报错）', () => {
    const data = { document: { title: 't', metadata: 'not json at all' } };
    expect(coerceJsonStringFields(documentSchema, data)).toBeNull();
  });
});
