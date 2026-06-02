import { Settings, SettingsEntity } from '@/shared/entities/Settings';
import type { SettingsRepositoryPort } from './settings.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { inject, singleton } from 'tsyringe';

@singleton()
export class SettingsRepository implements SettingsRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async findByUserId(userId: string): Promise<Settings | null> {
    const repo = this.db.getRepository(SettingsEntity);
    return repo.findOne({ where: { userId } });
  }

  async create(userId: string, defaults: Partial<Settings>): Promise<Settings> {
    const repo = this.db.getRepository(SettingsEntity);
    const settings = repo.create({ userId, ...defaults });
    return repo.save(settings);
  }

  async updateByUserId(
    userId: string,
    data: Partial<Pick<Settings, 'themeMode' | 'locale'>>,
  ): Promise<void> {
    const repo = this.db.getRepository(SettingsEntity);
    await repo.update({ userId }, data);
  }
}
