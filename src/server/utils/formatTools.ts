import { Tool } from '@/server/core/tool';
import { ConfigItem } from '@/shared/types';

export function formatToolsToMarkdown(tools: Tool[]): string {
  if (!tools || tools.length === 0) {
    return 'No tools available.';
  }

  return tools
    .map(tool => {
      const config = tool.config;
      const sections: string[] = [];

      sections.push(`### ${tool.id}`);
      sections.push('');
      sections.push(config.description.en);
      sections.push('');

      if (config.input && Object.keys(config.input).length > 0) {
        sections.push('**Input:**');
        sections.push('');
        sections.push(formatConfigItemsAsTable(config.input));
        sections.push('');
      }

      if (config.output && Object.keys(config.output).length > 0) {
        sections.push('**Output:**');
        sections.push('');
        sections.push(formatConfigItemsAsTable(config.output));
        sections.push('');
      }

      return sections.join('\n');
    })
    .join('\n---\n\n');
}

function formatConfigItemsAsTable(items: Record<string, ConfigItem>): string {
  const rows: string[] = [];

  rows.push('| Parameter | Required | Description |');
  rows.push('|-----------|----------|-------------|');

  Object.entries(items).forEach(([key, item]) => {
    if (item.type === 'group') {
      rows.push(`| ${key} | group | ${item.label.en} |`);
      if (item.children) {
        Object.entries(item.children).forEach(([childKey, childItem]) => {
          if (childItem.type !== 'group') {
            const required = childItem.required ? 'Yes' : 'No';
            const description = childItem.description?.en || '';
            rows.push(`| ${key}.${childKey} | ${required} | ${description} |`);
          }
        });
      }
    } else {
      const required = item.required ? 'Yes' : 'No';
      const description = item.description?.en || '';
      rows.push(`| ${key} | ${required} | ${description} |`);
    }
  });

  return rows.join('\n');
}
