export type { Translation, DeepPartial, TranslationKeys } from './locale.types';
export {
  currentLanguageStore,
  tStore,
  setLanguage,
  getLanguage,
  t,
  addDynamicLocale,
  preloadDefaultLocale,
  type Language,
} from './helpers';