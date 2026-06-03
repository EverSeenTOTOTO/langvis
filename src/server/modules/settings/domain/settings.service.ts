import type { Settings } from '@/shared/entities/Settings';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { LocaleService } from '@/server/libs/infrastructure/locale.service';
import { SETTINGS_REPOSITORY } from '../settings.di-tokens';
import type { SettingsRepositoryPort } from '../database/settings.repository.port';

@service()
export class SettingsService {
  constructor(
    @inject(LocaleService) private localeService: LocaleService,
    @inject(SETTINGS_REPOSITORY)
    private readonly repo: SettingsRepositoryPort,
  ) {}

  async getOrCreateSettings(userId: string): Promise<Settings> {
    let settings = await this.repo.findByUserId(userId);

    if (!settings) {
      settings = await this.repo.create(userId, {
        themeMode: 'dark',
        locale: 'en_US',
      });
    }

    return settings;
  }

  async updateSettings(
    userId: string,
    data: Partial<Pick<Settings, 'themeMode' | 'locale'>>,
  ): Promise<Settings> {
    await this.repo.updateByUserId(userId, data);
    return this.getOrCreateSettings(userId);
  }

  async getSettingsWithTranslations(userId: string): Promise<{
    themeMode: string;
    locale: string;
    translations: Record<string, string>;
  }> {
    await this.localeService.initialize();
    const settings = await this.getOrCreateSettings(userId);
    const translations = this.localeService.getTranslations(settings.locale);

    return {
      themeMode: settings.themeMode,
      locale: settings.locale,
      translations,
    };
  }
}
