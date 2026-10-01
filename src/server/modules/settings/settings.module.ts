import { Module } from '@nestjs/common';
import { SETTINGS_REPOSITORY } from './settings.di-tokens';
import { SettingsRepository } from './infrastructure/persistence/settings.repository';
import { LocaleService } from './infrastructure/locale.service';
import { SettingsService } from './application/settings.service';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [SettingsController],
  providers: [
    SettingsService,
    LocaleService,
    { provide: SETTINGS_REPOSITORY, useClass: SettingsRepository },
  ],
})
export class SettingsModule {}
