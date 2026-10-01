import { Module } from '@nestjs/common';
import { SETTINGS_REPOSITORY } from './settings.di-tokens';
import { SettingsRepository } from './infrastructure/persistence/settings.repository';
import { SettingsService } from './application/settings.service';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [SettingsController],
  providers: [
    SettingsService,
    { provide: SETTINGS_REPOSITORY, useClass: SettingsRepository },
  ],
})
export class SettingsModule {}
