import { container } from 'tsyringe';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { SkillService } from '@/server/modules/agent/application/service/skill.service';
import type { SkillInfo } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface RetrievedTools {
  tools: Tool[];
  skills: SkillInfo[];
}

const CJK = /[一-鿿㐀-䶿]/;

// 按脚本边界切段：CJK 连续段、拉丁/数字段分别成 token；纯空白切分会让 "pdf" 埋在路径里命不中。
const SEGMENT_RE = /[一-鿿㐀-䶿]+|[A-Za-z0-9]+/g;

export function tokenizeQuery(query: string): string[] {
  const keywords: string[] = [];

  for (const token of query.split(/\s+/).filter(Boolean)) {
    keywords.push(token);

    for (const match of token.matchAll(SEGMENT_RE)) {
      const seg = match[0];
      if (CJK.test(seg[0])) {
        if (seg.length >= 2) {
          for (let i = 0; i + 2 <= seg.length; i++) {
            keywords.push(seg.slice(i, i + 2));
          }
        } else {
          keywords.push(seg);
        }
      } else {
        keywords.push(seg);
      }
    }
  }

  return keywords;
}

export function matchFilter(
  keywords: string[] | undefined,
  text: string,
): boolean {
  if (!keywords || keywords.length === 0) return true;
  const hay = text.toLowerCase();
  return keywords.some(k => hay.includes(k.toLowerCase()));
}

/** ListToolsTool 与 ToolHintHook 共用的关键词检索。默认排除 list_tools 自身。 */
export async function retrieveRelevantTools(
  toolService: ToolService,
  skillService: SkillService,
  query?: string,
  opts?: { excludeToolIds?: string[] },
): Promise<RetrievedTools> {
  const keywords = query?.trim() ? tokenizeQuery(query.trim()) : undefined;
  const exclude = new Set(opts?.excludeToolIds ?? [ToolIds.LIST_TOOLS]);

  const allTools = await toolService.getAllToolInfo();
  const tools = allTools
    .filter(t => !exclude.has(t.id))
    .filter(t =>
      matchFilter(keywords, `${t.id} ${t.name} ${t.description ?? ''}`),
    )
    .map(t => {
      try {
        return container.resolve<Tool>(t.id);
      } catch {
        return null;
      }
    })
    .filter((t): t is Tool => t !== null);

  const allSkills = await skillService.getAllSkillInfo();
  const skills = allSkills.filter(s =>
    matchFilter(keywords, `${s.id} ${s.name} ${s.description ?? ''}`),
  );

  return { tools, skills };
}
