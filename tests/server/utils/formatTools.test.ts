import { describe, it, expect } from 'vitest';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';

/** formatToolsToMarkdown 只读 .id 与 .config.{description,inputSchema,outputSchema}，故用最小桩。 */
function makeTool(overrides: Record<string, unknown> = {}): Tool {
  return {
    id: 'demo_tool',
    config: {
      description: 'A demo tool for testing.',
      inputSchema: {
        type: 'object',
        properties: {
          color: {
            type: 'string',
            enum: ['red', 'green', 'blue'],
            description: 'Pick a color.',
          },
          mood: {
            type: 'string',
            enum: ['happy', 'hate'],
            default: 'hate',
            description: 'A mood.',
          },
          speed: {
            type: 'number',
            minimum: 0.5,
            maximum: 2.0,
            default: 1.2,
            description: 'Speed.',
          },
          name: {
            type: 'string',
            maxLength: 100,
            description: 'A name.',
          },
          note: {
            type: 'string',
            description: 'No constraints here.',
          },
        },
        required: ['color'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: 'result' },
        },
        required: ['ok'],
      },
    },
    ...overrides,
  } as unknown as Tool;
}

describe('formatToolsToMarkdown', () => {
  const tool = makeTool();

  describe('默认（简洁）模式', () => {
    const md = formatToolsToMarkdown([tool]);

    it('保留三列表与 description', () => {
      expect(md).toContain('### demo_tool');
      expect(md).toContain('| Parameter | Required | Description |');
      expect(md).toContain('| color | Yes | Pick a color. |');
    });

    it('不暴露任何 schema 约束（enum/default/range/maxLength）', () => {
      expect(md).not.toContain('one of');
      expect(md).not.toContain('range [');
      expect(md).not.toContain('default ');
      expect(md).not.toContain('max 100 chars');
      // 枚举值只应在 detail 模式出现（用反引号包裹形式，避免误匹配 "Required"）
      expect(md).not.toContain('`red`');
      expect(md).not.toContain('- **');
    });
  });

  describe('detail 模式', () => {
    const md = formatToolsToMarkdown([tool], { detail: true });

    it('表格仍在（两种模式共用）', () => {
      expect(md).toContain('| Parameter | Required | Description |');
      expect(md).toContain('| color | Yes | Pick a color. |');
    });

    it('展开枚举全部值（不截断）', () => {
      expect(md).toContain('one of `red`, `green`, `blue`');
      expect(md).toContain('one of `happy`, `hate`');
    });

    it('required 属性带 (required) 标记', () => {
      expect(md).toContain('- **color** (required):');
      // 非_required 的 mood 不带该标记
      expect(md).toContain('- **mood**: one of');
    });

    it('range / number default / string default', () => {
      // JS 数字 2.0 === 2，渲染为 "2"（语义不变）
      expect(md).toContain('range [0.5, 2]');
      expect(md).toContain('default 1.2');
      expect(md).toContain('default `hate`');
    });

    it('maxLength 渲染为 max N chars', () => {
      expect(md).toContain('max 100 chars');
    });

    it('多约束用分号串联', () => {
      // mood: enum + string default
      expect(md).toContain('one of `happy`, `hate`; default `hate`');
      // speed: range + number default
      expect(md).toContain('range [0.5, 2]; default 1.2');
    });

    it('无约束属性不生成子弹', () => {
      expect(md).not.toContain('- **note**');
    });
  });
});
