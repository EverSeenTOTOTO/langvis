import type { Settings } from '@/shared/entities/Settings';

export interface SettingsRepositoryPort {
  findByUserId(userId: string): Promise<Settings | null>;

  create(userId: string, defaults: Partial<Settings>): Promise<Settings>;

  updateByUserId(
    userId: string,
    data: Partial<Pick<Settings, 'themeMode' | 'locale'>>,
  ): Promise<void>;
}
