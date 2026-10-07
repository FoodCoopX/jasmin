import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import de from './locales/de';

// German alone is bundled. It is the ``fallbackLng``, so keeping it resident
// is what guarantees a key always resolves to real text instead of to the raw
// key string — and, because i18next skips its loader entirely for as long as
// ``resources`` is set, it is also what keeps ``init`` and ``changeLanguage``
// synchronous. Every other language is a Rollup chunk that
// ``activateLanguage`` fetches on demand.
const resources = {
  de: {
    translation: de
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // German, the in-house default, fills in any key the active language
    // lacks.
    fallbackLng: 'de',

    defaultNS: 'translation',

    debug: import.meta.env.DEV,

    interpolation: {
      escapeValue: false,
    },

    detection: {
      // LocaleProvider decides the app's language — the signed-in user's,
      // else one picked in this browser, else the browser's own when the app
      // offers it, else the farm's, else German — and JasminApp switches to
      // it through ``activateLanguage``. Before that, and on the super-admin
      // domain, which has no such bridge, the detector's choice stands: the
      // language last shown in this browser (``i18nextLng``, cached on every
      // change), else the ``lang`` of index.html. ``navigator`` stays out:
      // the browser's languages are LocaleProvider's to weigh, and it takes
      // only those the app offers, where the detector would take any.
      order: ['localStorage', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    
    react: {
      useSuspense: false,
    }
  });

/** Each ``import`` is a distinct string literal so Vite can split one chunk
 * per language, the same shape ``loadDayjsLocale`` uses for dayjs. */
async function importLanguage(
  code: string,
): Promise<Record<string, unknown> | null> {
  switch (code) {
    case 'en':
      return (await import('./locales/en')).default;
    case 'fr':
      return (await import('./locales/fr')).default;
    case 'it':
      return (await import('./locales/it')).default;
    default:
      return null;
  }
}

/** How many ``activateLanguage`` calls have begun, so each can tell whether a
 * later one started while it waited. */
let activationCount = 0;

/**
 * Load a language's bundle if it isn't resident, then switch to it.
 *
 * The bundle is registered BEFORE the switch, so no render can observe a
 * language without its keys: react-i18next re-renders on ``languageChanged``
 * and not on a store addition, which makes the swap a single repaint rather
 * than a frame of German followed by a frame of the target language.
 *
 * A call that brings a bundle in switches even when i18next already names
 * that language, as it does from the start of a visit that boots on English
 * (the language last shown in this browser, or index.html's ``lang``). Until
 * the bundle lands every key falls back to German, and only the
 * ``languageChanged`` of the switch repaints what was rendered meanwhile.
 *
 * Whatever happens, the language i18next ends up on is one whose bundle is
 * loaded — a failed fetch settles on German. Several call sites read
 * ``i18n.language`` synchronously and one of them posts it as a new member's
 * ``user_language``, so it must never name a bundle that isn't there.
 *
 * When calls overlap, the latest one decides: a call whose fetch lands after a
 * later call began does not switch, so a slow bundle — the one the app booted
 * in, or a language the visitor picked and then changed — can't undo the
 * language chosen since.
 */
export async function activateLanguage(language: string): Promise<void> {
  const code = (language || '').split('-')[0];
  if (!code) return;
  const activation = ++activationCount;
  let added = false;

  if (!i18n.hasResourceBundle(code, 'translation')) {
    try {
      const bundle = await importLanguage(code);
      if (bundle) {
        i18n.addResourceBundle(code, 'translation', bundle, true, true);
        added = true;
      }
    } catch (err) {
      console.warn(`Failed to load the "${code}" translations:`, err);
    }
  }
  if (activation !== activationCount) return;

  const target = i18n.hasResourceBundle(code, 'translation') ? code : 'de';
  if (added || i18n.language !== target) {
    await i18n.changeLanguage(target);
  }
}

// Sync <html lang> with current language
i18n.on('languageChanged', (lng: string) => {
  document.documentElement.lang = lng;
});
// Set initial lang
document.documentElement.lang = i18n.language || 'en';

// The detector resolves a language before any component mounts, and only
// German is bundled — so a returning EN user boots pointing at a language
// with no keys. Kick the fetch off here rather than from a component: the
// super-admin app mounts no language bridge at all, yet chrome shared by both
// domains (the offline banner, the error boundary) still translates.
void activateLanguage(i18n.language);

export default i18n;
