import { service } from '../decorator/service';
import { readFile } from 'fs/promises';
import { join } from 'path';

const LOCALES_DIR = join(import.meta.dirname, '../locales');

@service()
export class LocaleService {
  private translations: Record<string, Record<string, string>> = {};
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const locales = ['en_US', 'zh_CN'];

    await Promise.all(
      locales.map(async locale => {
        const filePath = join(LOCALES_DIR, locale, 'translation.json');
        try {
          const content = await readFile(filePath, 'utf-8');
          this.translations[locale] = JSON.parse(content);
        } catch {
          this.translations[locale] = {};
        }
      }),
    );

    this.initialized = true;
  }

  getTranslations(locale: string): Record<string, string> {
    return this.translations[locale] || {};
  }

  getSupportedLocales(): string[] {
    return Object.keys(this.translations);
  }
}
