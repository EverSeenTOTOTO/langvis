import { container, Lifecycle } from 'tsyringe';
import { SETTINGS_REPOSITORY } from './settings.di-tokens';
import { SettingsRepository } from './database/settings.repository';

container.register(SETTINGS_REPOSITORY, SettingsRepository, {
  lifecycle: Lifecycle.Singleton,
});
