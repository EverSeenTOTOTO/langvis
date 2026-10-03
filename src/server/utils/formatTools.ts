import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { JSONSchemaObject } from 'openai/lib/jsonschema.mjs';
import type { SkillInfo } from '@/server/modules/agent/application/service/skill.service';

type SchemaProp = {
  description?: string;
  enum?: readonly unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

export function formatSkillsToMarkdown(skills: SkillInfo[]): string {
  if (!skills || skills.length === 0) {
    return 'No skills available.';
  }

  return skills
    .map(skill => {
      const sections: string[] = [];
      sections.push(`### ${skill.id}`);
      sections.push('');
      sections.push(skill.description);
      sections.push('');
      sections.push('**Input:** `skillId` (string) — 技能ID');
      sections.push('');
      return sections.join('\n');
    })
    .join('\n---\n\n');
}

/** roster 单行：描述首行，超长截断——常驻名单以匹配信号优先，完整描述走 list_tools。 */
function oneLine(description: string | undefined, max = 160): string {
  const line = (description ?? '').split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** system prompt 常驻 roster：listed 工具单行清单（inline 工具有全量文档，不进此列）。 */
export function formatToolRoster(tools: Tool[]): string {
  return tools
    .map(t => `- \`${t.id}\` — ${oneLine(t.config.description)}`)
    .join('\n');
}

export function formatSkillRoster(skills: SkillInfo[]): string {
  return skills
    .map(s => `- \`${s.id}\` — ${oneLine(s.description)}`)
    .join('\n');
}

export function formatToolsToMarkdown(
  tools: Tool[],
  opts?: { detail?: boolean },
): string {
  if (!tools || tools.length === 0) {
    return 'No tools available.';
  }

  const detail = opts?.detail ?? false;

  return tools
    .map(tool => {
      const config = tool.config;
      const sections: string[] = [];

      sections.push(`### ${tool.id}`);
      sections.push('');
      sections.push(config.description);

      if (!detail) return sections.join('\n');

      sections.push('');

      const inputSchema = config.inputSchema as JSONSchemaObject;
      const outputSchema = config.outputSchema as JSONSchemaObject;

      if (inputSchema?.properties) {
        sections.push('**Input:**');
        sections.push('');
        sections.push(
          formatSchemaAsTable(
            inputSchema.properties,
            inputSchema.required as string[],
          ),
        );
        sections.push('');
      }

      if (outputSchema?.properties) {
        sections.push('**Output:**');
        sections.push('');
        sections.push(
          formatSchemaAsTable(
            outputSchema.properties,
            outputSchema.required as string[],
          ),
        );
        sections.push('');
      }

      return sections.join('\n');
    })
    .join('\n---\n\n');
}

type PropSchema = SchemaProp & {
  type?: string;
  properties?: Record<string, unknown>;
  required?: readonly string[];
  items?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
};

const NESTED_DEPTH_LIMIT = 2;

// schema 表：顶层参数 + 嵌套展开——object 属性（document.title）与 array-of-object
// 元素（chunks[].content）递归成行，否则嵌套形状对模型完全不可见。
function formatSchemaAsTable(
  properties: JSONSchemaObject['properties'],
  required?: readonly string[],
): string {
  const rows: string[] = [
    '| Parameter | Required | Description |',
    '|-----------|----------|-------------|',
  ];

  if (typeof properties !== 'object' || properties === null) {
    return rows.join('\n');
  }

  const walk = (
    props: Record<string, unknown>,
    req: Set<string>,
    prefix: string,
    depth: number,
  ): void => {
    if (depth > NESTED_DEPTH_LIMIT) return;
    for (const [key, raw] of Object.entries(props)) {
      const prop = raw as PropSchema;
      const name = `${prefix}${key}`;
      rows.push(
        `| ${name} | ${req.has(key) ? 'Yes' : 'No'} | ${prop.description ?? ''} |`,
      );
      if (prop.type === 'object' && prop.properties) {
        walk(
          prop.properties,
          new Set(prop.required ?? []),
          `${name}.`,
          depth + 1,
        );
      } else if (
        prop.type === 'array' &&
        prop.items?.type === 'object' &&
        prop.items.properties
      ) {
        walk(
          prop.items.properties,
          new Set(prop.items.required ?? []),
          `${name}[].`,
          depth + 1,
        );
      }
    }
  };
  walk(properties as Record<string, unknown>, new Set(required ?? []), '', 0);

  const entries = Object.entries(properties);
  const bullets = entries
    .map(([key, prop]) =>
      formatConstraints(
        key,
        prop as SchemaProp,
        (required ?? []).includes(key),
      ),
    )
    .filter((b): b is string => b !== null);
  if (bullets.length > 0) {
    return `${rows.join('\n')}\n\n${bullets.join('\n')}`;
  }

  return rows.join('\n');
}

// 为带约束的属性补一条子弹（无约束的属性不出现，保持紧凑）。 枚举列出全部合法值（不截断）。
function formatConstraints(
  key: string,
  prop: SchemaProp,
  required: boolean,
): string | null {
  const parts: string[] = [];

  if (Array.isArray(prop.enum)) {
    parts.push(`one of ${prop.enum.map(v => `\`${v}\``).join(', ')}`);
  }
  if (prop.minimum !== undefined && prop.maximum !== undefined) {
    parts.push(`range [${prop.minimum}, ${prop.maximum}]`);
  } else if (prop.minimum !== undefined) {
    parts.push(`≥ ${prop.minimum}`);
  } else if (prop.maximum !== undefined) {
    parts.push(`≤ ${prop.maximum}`);
  }
  if (typeof prop.maxLength === 'number') {
    parts.push(`max ${prop.maxLength} chars`);
  }
  if (prop.default !== undefined) {
    parts.push(
      `default ${typeof prop.default === 'string' ? `\`${prop.default}\`` : prop.default}`,
    );
  }

  if (parts.length === 0) return null;
  return `- **${key}**${required ? ' (required)' : ''}: ${parts.join('; ')}`;
}
