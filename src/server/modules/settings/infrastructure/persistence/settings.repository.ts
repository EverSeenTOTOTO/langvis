import { Inject } from '@nestjs/common';
import { Settings, SettingsEntity } from '@/shared/entities/Settings';
import type { SettingsRepositoryPort } from '../../domain/port/settings.repository.port';
import { DatabaseService } from '@/server/infrastructure/database/database.service';

export class SettingsRepository implements SettingsRepositoryPort {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

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
