import type { TFunction } from "i18next";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TenantContext } from "@shared/contexts/TenantContext";
import i18n, { loadLanguageBundle } from "@shared/i18n";

/**
 * A ``t`` in the farm's language instead of the reader's, for words the app
 * writes into stored data — the purchased suffix of an article's name — which
 * must read the same whoever wrote them and whoever reads them. German until
 * the farm's language has loaded, and outside a farm (the platform domain has
 * no TenantProvider).
 */
export function useTenantLanguageT(): TFunction {
  const tenant = useContext(TenantContext)?.tenant;
  const language = (
    (tenant?.tenant_language as string | null | undefined) || "de"
  ).split("-")[0];
  // The language whose bundle has loaded, so a change of the farm's language
  // waits for the new bundle instead of reading the old flag.
  const [loadedLanguage, setLoadedLanguage] = useState(() =>
    i18n.hasResourceBundle(language, "translation") ? language : "de",
  );

  useEffect(() => {
    let cancelled = false;
    void loadLanguageBundle(language).then(() => {
      if (!cancelled && i18n.hasResourceBundle(language, "translation")) {
        setLoadedLanguage(language);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return useTranslation(undefined, {
    lng: loadedLanguage === language ? language : "de",
  }).t;
}
