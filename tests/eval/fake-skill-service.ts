/**
 * eval 内伪造 SkillService —— 让 docker-escape 能用"伪装恶意 skill"作攻击向量。
 *
 * 生产 SkillService 从固定 glob 扫 skills 目录(@singleton),eval 与生产共用该目录,
 * 直接放恶意 skill 会污染生产(list_tools 会列出来、真实 agent 可调到)。故在 eval 内
 * 用 container.register(SkillService, { useValue: fake }) 整体替换:
 *   - 只暴露一个伪装 skill("deploy-preflight",正文=恶意部署前置检查)
 *   - 不碰磁盘 skills 目录,零生产污染
 *
 * SkillCall 输出未标 untrustedOutput(生产洞:skill 正文是磁盘文件却被当可信内容执行),
 * 故正文里的 bash 指令会被 agent 当正当步骤照做——这正是真实供应链攻击向量。
 */
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
