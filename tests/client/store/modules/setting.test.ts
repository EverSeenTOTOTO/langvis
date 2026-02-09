import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { SettingStore } from '@/client/store/modules/setting';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';

vi.mock('i18next', () => ({
  default: {
    init: vi.fn().mockReturnValue(Promise.resolve()),
    changeLanguage: vi.fn().mockReturnValue(Promise.resolve()),
    getFixedT: vi.fn(() => (key: string) => key),
    isInitialized: false,
    t: vi.fn((key: string) => key),
  },
}));

describe('SettingStore', () => {
  let settingStore: SettingStore;

  beforeEach(() => {
    container.clearInstances();
    vi.clearAllMocks();
    settingStore = container.resolve(SettingStore);
  });

  describe('initialization', () => {
    it('should initialize with default dark mode', () => {
      expect(settingStore.mode).toBe('dark');
    });

    it('should initialize with default English language', () => {
      expect(settingStore.lang).toBe('en_US');
    });

    it('should initialize with translation function', () => {
      expect(settingStore.tr).toBeDefined();
      expect(typeof settingStore.tr).toBe('function');
    });
  });

  describe('toggleMode', () => {
    it('should toggle from dark to light', () => {
      settingStore.mode = 'dark';
      settingStore.toggleMode();
      expect(settingStore.mode).toBe('light');
    });

    it('should toggle from light to dark', () => {
      settingStore.mode = 'light';
      settingStore.toggleMode();
      expect(settingStore.mode).toBe('dark');
    });

    it('should toggle multiple times', () => {
      const initialMode = settingStore.mode;
      settingStore.toggleMode();
      const firstToggle = settingStore.mode;
      settingStore.toggleMode();
      const secondToggle = settingStore.mode;

      expect(firstToggle).not.toBe(initialMode);
      expect(secondToggle).toBe(initialMode);
    });
  });

  describe('setLang', () => {
    it('should set language to Chinese', () => {
      settingStore.setLang('zh_CN');
      expect(settingStore.lang).toBe('zh_CN');
    });

    it('should set language to English', () => {
      settingStore.setLang('en_US');
      expect(settingStore.lang).toBe('en_US');
    });

    it('should update language multiple times', () => {
      settingStore.setLang('zh_CN');
      expect(settingStore.lang).toBe('zh_CN');

      settingStore.setLang('en_US');
      expect(settingStore.lang).toBe('en_US');
    });
  });

  describe('setLocale', () => {
    it('should set locale to English', () => {
      settingStore.setLocale(enUS);
      expect(settingStore.locale).toEqual(enUS);
    });

    it('should set locale to Chinese', () => {
      settingStore.setLocale(zhCN);
      expect(settingStore.locale).toEqual(zhCN);
    });

    it('should update locale', () => {
      settingStore.setLocale(enUS);
      expect(settingStore.locale).toEqual(enUS);

      settingStore.setLocale(zhCN);
      expect(settingStore.locale).toEqual(zhCN);
    });
  });

  describe('setTr', () => {
    it('should set translation function', () => {
      const mockTr = vi.fn((key: string) => `translated_${key}`);
      settingStore.setTr(mockTr as any);
      expect(typeof settingStore.tr).toBe('function');
    });

    it('should allow calling translation function', () => {
      const mockTr = vi.fn((key: string) => `translated_${key}`);
      settingStore.setTr(mockTr as any);

      const result = settingStore.tr('test.key');
      expect(result).toBe('translated_test.key');
    });
  });
});
