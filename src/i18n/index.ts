// SPDX-License-Identifier: AGPL-3.0-only
export {
  LANGUAGE_BROWSER,
  LANGUAGE_CHINESE,
  LANGUAGE_ENGLISH,
  applyHtmlLang,
  currentLocale,
  currentPreference,
  cycleLanguagePreference,
  ensureLocale,
  formatNumber,
  htmlLang,
  isChineseLanguageTag,
  languageStorageKey,
  localeFromNavigator,
  onLocaleChange,
  parseLanguagePreference,
  resolveLocale,
  setLanguagePreference,
  type LanguagePreference,
  type Locale,
} from "./locale";
export { choiceLabel } from "./choices";
export {
  localizedTool,
  localizedWorkbench,
  toolSearchText,
  toolsZh,
  type ToolTranslation,
} from "./catalog";
export { applyDocumentMessages, applyLocalizedCatalog } from "./dom";
export {
  languageButtonLabel,
  t,
  themeButtonLabel,
  toolCountLabel,
  type MessageKey,
} from "./messages";
