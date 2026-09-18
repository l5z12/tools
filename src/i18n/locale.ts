// SPDX-License-Identifier: AGPL-3.0-only
export const LANGUAGE_BROWSER = 0;
export const LANGUAGE_ENGLISH = 1;
export const LANGUAGE_CHINESE = 2;

export type LanguagePreference = 0 | 1 | 2;
export type Locale = "en" | "zh";

export const languageStorageKey = "l5z12-lang";

type NavigatorLanguages = {
  language?: string;
  languages?: readonly string[];
};

let preference: LanguagePreference = LANGUAGE_BROWSER;
let locale: Locale = "en";
let ready = false;
const listeners = new Set<() => void>();

export function isChineseLanguageTag(tag: string): boolean {
  return /^zh\b/i.test(tag.trim());
}

export function localeFromNavigator(nav: NavigatorLanguages): Locale {
  const tags = [...(nav.languages ?? []), nav.language ?? ""].filter(Boolean);
  return tags.some(isChineseLanguageTag) ? "zh" : "en";
}

export function resolveLocale(
  value: LanguagePreference,
  nav: NavigatorLanguages,
): Locale {
  if (value === LANGUAGE_ENGLISH) return "en";
  if (value === LANGUAGE_CHINESE) return "zh";
  return localeFromNavigator(nav);
}

export function parseLanguagePreference(
  raw: string | null,
): LanguagePreference {
  if (raw === "1") return LANGUAGE_ENGLISH;
  if (raw === "2") return LANGUAGE_CHINESE;
  return LANGUAGE_BROWSER;
}

function readStoredPreference(): LanguagePreference {
  try {
    return parseLanguagePreference(localStorage.getItem(languageStorageKey));
  } catch {
    return LANGUAGE_BROWSER;
  }
}

function writeStoredPreference(value: LanguagePreference): void {
  try {
    localStorage.setItem(languageStorageKey, String(value));
  } catch {
    /* private mode */
  }
}

export function htmlLang(value: Locale = locale): string {
  return value === "zh" ? "zh-CN" : "en";
}

export function applyHtmlLang(value: Locale = locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = htmlLang(value);
}

export function currentPreference(): LanguagePreference {
  ensureLocale();
  return preference;
}

export function currentLocale(): Locale {
  ensureLocale();
  return locale;
}

export function ensureLocale(): Locale {
  if (ready) return locale;
  ready = true;
  if (typeof navigator !== "undefined") {
    preference = readStoredPreference();
    locale = resolveLocale(preference, navigator);
    applyHtmlLang(locale);
  }
  return locale;
}

export function onLocaleChange(listener: () => void): void {
  listeners.add(listener);
}

export function setLanguagePreference(value: LanguagePreference): Locale {
  ensureLocale();
  preference = value;
  locale = resolveLocale(
    value,
    typeof navigator === "undefined" ? {} : navigator,
  );
  writeStoredPreference(value);
  applyHtmlLang(locale);
  for (const listener of listeners) listener();
  return locale;
}

export function cycleLanguagePreference(): LanguagePreference {
  const next = ((currentPreference() + 1) % 3) as LanguagePreference;
  setLanguagePreference(next);
  return next;
}

export function formatNumber(value: number): string {
  return value.toLocaleString(currentLocale() === "zh" ? "zh-CN" : "en");
}
