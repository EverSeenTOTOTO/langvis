import matter from 'gray-matter';
import { globby } from 'globby';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export interface SkillData extends SkillInfo {
  content: string;
}

@service()
export class SkillService {
  private skills = new Map<string, SkillData>();
  private isInitialized = false;

  private readonly logger = Logger.child({ source: 'SkillService' });

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const pattern = `./${isProd ? 'dist' : 'src'}/server/core/skill/*/skill.md`;

      const skillPaths = await globby(pattern, {
        cwd: process.cwd(),
        absolute: true,
      });

      for (const absolutePath of skillPaths) {
        try {
          const { default: fs } = await import('fs');
          const raw = fs.readFileSync(absolutePath, 'utf-8');
          const { data, content } = matter(raw);

          // Extract skill id from folder name
          const parts = absolutePath.split('/');
          const skillFolder = parts[parts.length - 2];
          const id = skillFolder;

          const name = data.name ?? id;
          const description = data.description ?? '';

          this.skills.set(id, { id, name, description, content });
        } catch (error) {
          this.logger.error(`Failed to load skill at ${absolutePath}:`, error);
        }
      }

      this.logger.info(
        `Discovered ${this.skills.size} skills:`,
        [...this.skills.values()].map(s => s.id),
      );
    } catch (e) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize SkillService:', e);
    }
  }

  async getAllSkillInfo(): Promise<SkillInfo[]> {
    await this.initialize();
    return [...this.skills.values()].map(({ content: _, ...info }) => info);
  }

  async getSkillContent(id: string): Promise<string | undefined> {
    await this.initialize();
    return this.skills.get(id)?.content;
  }
}
