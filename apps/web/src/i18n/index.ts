import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALES, type Locale } from '@reminder/shared';
import en from './en';
import it from './it';

export const resources = { it: { translation: it }, en: { translation: en } } as const;

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem('locale');
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* ignore */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'it').slice(0, 2);
  return (LOCALES as readonly string[]).includes(nav) ? (nav as Locale) : 'it';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: 'it',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem('locale', locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale;
  void i18n.changeLanguage(locale);
}

/** BCP-47 tag used for Intl formatting. */
export function intlLocale(): string {
  return i18n.language === 'en' ? 'en-GB' : 'it-IT';
}

export default i18n;
