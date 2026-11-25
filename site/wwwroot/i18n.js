import { languageOption, locales, matchLocale, preferredLocale, storedLanguage, storeLanguage } from './locale.js';
import { dictionaries } from './translations.js';

const storageKey = 'ioextend-language';
let preference = matchLocale(storedLanguage(storageKey)) ?? 'auto';
export let lang = preference === 'auto' ? browserLanguage() : preference;

function browserLanguage() {
  return preferredLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export const message = (key, values) => ({ key, values });
export const hasTranslation = key => Object.hasOwn(dictionaries.en, key);

export function t(key, values) {
  const text = dictionaries[lang][key];
  if (text === undefined) throw new Error(`Missing UI string '${key}'.`);
  return values ? text.replace(/\{(\w+)\}/g, (_, name) => values[name]) : text;
}

export function localize(value) {
  return typeof value === 'object' && value !== null ? t(value.key, value.values) : value ?? '';
}

export function formatNumber(value, options) {
  return new Intl.NumberFormat(lang, options).format(value);
}

export function setupLanguage() {
  const select = document.getElementById('site-language');
  select.append(new Option('', 'auto'), ...locales.map(languageOption));
  select.value = preference;
  function render() {
    document.documentElement.lang = lang;
    document.title = t('siteTitle');
    select.setAttribute('aria-label', t('language'));
    select.options[0].textContent = t('auto');
    for (const element of document.querySelectorAll('[data-i18n]')) {
      const label = t(element.dataset.i18n);
      if (element.dataset.i18nAttr) element.setAttribute(element.dataset.i18nAttr, label);
      else element.textContent = label;
    }
    document.dispatchEvent(new Event('localechange'));
  }

  function changeLanguage() {
    const next = preference === 'auto' ? browserLanguage() : preference;
    if (next === lang) return;
    lang = next;
    render();
  }

  select.addEventListener('change', () => {
    preference = select.value;
    storeLanguage(storageKey, preference);
    changeLanguage();
  });
  window.addEventListener('languagechange', changeLanguage);
  render();
}
