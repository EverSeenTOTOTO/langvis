import fs from 'fs';
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

interface SkillEntry extends SkillInfo {
  filePath: string;
}

@service()
export class SkillService {
  private skills = new Map<string, SkillEntry>();
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
          const raw = fs.readFileSync(absolutePath, 'utf-8');
          const { data } = matter(raw);

          const parts = absolutePath.split('/');
          const skillFolder = parts[parts.length - 2];
          const id = skillFolder;

          const name = data.name ?? id;
          const description = data.description ?? '';

          this.skills.set(id, {
            id,
            name,
            description,
            filePath: absolutePath,
          });
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
    return [...this.skills.values()].map(({ filePath: _, ...info }) => info);
  }

  getCachedSkillIds(): string[] {
    return [...this.skills.keys()];
  }

  async getSkillContent(id: string): Promise<string | undefined> {
    await this.initialize();
    const skill = this.skills.get(id);
    if (!skill) return undefined;
    return fs.readFileSync(skill.filePath, 'utf-8');
  }
}
