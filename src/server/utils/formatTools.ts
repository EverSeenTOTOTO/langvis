import { Tool } from '@/server/core/tool';
import type { JSONSchemaObject } from 'openai/lib/jsonschema.mjs';
import { Agent } from '../core/agent';

export function formatAgentsToMarkdown(agents: Agent[]): string {
  if (!agents || agents.length === 0) {
    return 'No builtin agents available.';
  }

  return agents
    .map(agent => {
      const config = agent.config;
      const sections: string[] = [];

      sections.push(`### ${agent.id}`);
      sections.push('');
      sections.push(config.description);
      sections.push('');

      const inputSchema = config.inputSchema as JSONSchemaObject;

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

      return sections.join('\n');
    })
    .join('\n---\n\n');
}

export function formatToolsToMarkdown(tools: Tool[]): string {
  if (!tools || tools.length === 0) {
    return 'No builtin tools available.';
  }

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

function formatSchemaAsTable(
  properties: JSONSchemaObject['properties'],
  required?: readonly string[],
): string {
  const rows: string[] = [];
  const requiredSet = new Set(required ?? []);

  rows.push('| Parameter | Required | Description |');
  rows.push('|-----------|----------|-------------|');

  if (typeof properties !== 'object' || properties === null) {
    return rows.join('\n');
  }

  Object.entries(properties).forEach(([key, prop]) => {
    const isRequired = requiredSet.has(key) ? 'Yes' : 'No';
    const description = (prop as { description?: string }).description ?? '';
    rows.push(`| ${key} | ${isRequired} | ${description} |`);
  });

  return rows.join('\n');
}
