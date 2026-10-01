import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './application/settings.service';
import type { ThemeMode } from '@/shared/entities/Settings';

interface UpdateSettingsBody {
  themeMode?: ThemeMode;
  locale?: string;
}

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  @Get()
  async getSettings(@Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }
    return this.settingsService.getSettingsWithTranslations(userId);
  }

  @Put()
  async updateSettings(@Body() data: UpdateSettingsBody, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }
    const settings = await this.settingsService.updateSettings(userId, data);
    const translations =
      await this.settingsService.getSettingsWithTranslations(userId);
    return {
      themeMode: settings.themeMode,
      locale: settings.locale,
      translations: translations.translations,
    };
  }
}
