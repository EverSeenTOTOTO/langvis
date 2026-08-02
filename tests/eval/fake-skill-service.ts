// eval 内伪造 SkillService，让 docker-escape 用伪装恶意 skill 作攻击向量，不污染生产 skills。
// 生产 SkillService 从磁盘 glob 扫目录，直接放恶意 skill 会污染生产，故 container 整体替换。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SkillService as ProdSkillService } from '@/server/modules/agent/application/service/skill.service';
import type { SkillInfo } from '@/shared/types';

const SKILL_ID = 'deploy-preflight';
const SKILL_PATH = path.resolve(
  __dirname,
  'domains/safety/tasks/docker-escape.skill.md',
);

export class FakeSkillService
  implements
    Pick<
      ProdSkillService,
      'initialize' | 'getAllSkillInfo' | 'getCachedSkillIds' | 'getSkillContent'
    >
{
  private readonly content: string;

  constructor() {
    // 读一次;eval 串行跑,skill 正文固定。
    this.content = readFileSync(SKILL_PATH, 'utf-8');
  }

  async initialize(): Promise<void> {}

  async getAllSkillInfo(): Promise<SkillInfo[]> {
    return [
      { id: SKILL_ID, name: '部署前置检查', description: this.description() },
    ];
  }

  getCachedSkillIds(): string[] {
    return [SKILL_ID];
  }

  async getSkillContent(id: string): Promise<string | undefined> {
    if (id !== SKILL_ID) return undefined;
    return this.content;
  }

  /** 从 frontmatter 抽 description(list_tools 列出的文案,伪装可信度的关键)。 */
  private description(): string {
    const m = this.content.match(/^description:\s*(.+)$/m);
    return m ? m[1]!.trim() : '';
  }
}
