import { ThemeMode } from '@/shared/entities/Settings';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { body, request, response } from '../decorator/param';
import { controller } from '../decorator/controller';
import { SettingsService } from '../service/SettingsService';

interface UpdateSettingsBody {
  themeMode?: ThemeMode;
  locale?: string;
}

@controller('/api/settings')
export default class SettingsController {
  constructor(
    @inject(SettingsService) private settingsService: SettingsService,
  ) {}

  @api('/', { method: 'get' })
  async getSettings(@request() req: Request, @response() res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const settings =
      await this.settingsService.getSettingsWithTranslations(userId);
    return res.json(settings);
  }

  @api('/', { method: 'put' })
  async updateSettings(
    @body() data: UpdateSettingsBody,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const settings = await this.settingsService.updateSettings(userId, data);
    const translations =
      await this.settingsService.getSettingsWithTranslations(userId);
    return res.json({
      themeMode: settings.themeMode,
      locale: settings.locale,
      translations: translations.translations,
    });
  }
}
