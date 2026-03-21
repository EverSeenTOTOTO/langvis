import { Settings, SettingsEntity } from '@/shared/entities/Settings';
import { service } from '../decorator/service';
import { inject } from 'tsyringe';
import pg from './pg';
import { LocaleService } from './LocaleService';

@service()
export class SettingsService {
  constructor(@inject(LocaleService) private localeService: LocaleService) {}

  async getOrCreateSettings(userId: string): Promise<Settings> {
    const repo = pg.getRepository(SettingsEntity);
    let settings = await repo.findOne({ where: { userId } });

    if (!settings) {
      settings = repo.create({
        userId,
        themeMode: 'dark',
        locale: 'en_US',
      });
      await repo.save(settings);
    }

    return settings;
  }

  async updateSettings(
    userId: string,
    data: Partial<Pick<Settings, 'themeMode' | 'locale'>>,
  ): Promise<Settings> {
    const repo = pg.getRepository(SettingsEntity);
    await repo.update({ userId }, data);
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
