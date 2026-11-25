export const locales = ['en', 'ru', 'es', 'de', 'fr', 'pt', 'it', 'ja', 'ko', 'zh-Hans', 'zh-Hant'];

export function matchLocale(tag) {
  if (typeof tag !== 'string' || !tag) return undefined;
  try {
    const locale = new Intl.Locale(tag);
    const candidate = locale.language === 'zh' ? `zh-${locale.maximize().script}` : locale.language;
    return locales.includes(candidate) ? candidate : undefined;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return undefined;
  }
}

export function preferredLocale(languages = []) {
  return languages.map(matchLocale).find(Boolean) ?? 'en';
}

export function languageOption(locale) {
  const label = new Intl.DisplayNames(locale, { type: 'language' }).of(locale);
  const option = new Option(label, locale);
  option.lang = locale;
  return option;
}

export function storedLanguage(key) {
  try { return globalThis.localStorage?.getItem(key); }
  catch (error) {
    if (error.name !== 'SecurityError') throw error;
    return null;
  }
}

export function storeLanguage(key, value) {
  try { globalThis.localStorage?.setItem(key, value); }
  catch (error) {
    if (!['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error;
  }
}
