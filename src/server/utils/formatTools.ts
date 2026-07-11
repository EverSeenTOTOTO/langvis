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
            detail,
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
            detail,
          ),
        );
        sections.push('');
      }

      return sections.join('\n');
    })
    .join('\n---\n\n');
}

function formatSchemaAsTable(
  properties: JSONSchemaObject['properties'],
  required?: readonly string[],
  detail = false,
): string {
  const rows: string[] = [];
  const requiredSet = new Set(required ?? []);

  rows.push('| Parameter | Required | Description |');
  rows.push('|-----------|----------|-------------|');

  if (typeof properties !== 'object' || properties === null) {
    return rows.join('\n');
  }

  const entries = Object.entries(properties);

  entries.forEach(([key, prop]) => {
    const isRequired = requiredSet.has(key) ? 'Yes' : 'No';
    const description = (prop as { description?: string }).description ?? '';
    rows.push(`| ${key} | ${isRequired} | ${description} |`);
  });

  if (detail) {
    const bullets = entries
      .map(([key, prop]) =>
        formatConstraints(key, prop as SchemaProp, requiredSet.has(key)),
      )
      .filter((b): b is string => b !== null);
    if (bullets.length > 0) {
      return `${rows.join('\n')}\n\n${bullets.join('\n')}`;
    }
  }

  return rows.join('\n');
}

/**
 * detail 模式下，为带约束的属性补一条子弹（无约束的属性不出现，保持紧凑）。
 * 枚举列出全部合法值（不截断）——这正是 detail 模式存在的意义。
 */
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
