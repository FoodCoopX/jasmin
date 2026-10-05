import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import dayjs from "dayjs";
import { useAuth } from "./AuthContext";
import { TenantContext } from "./TenantContext";
import { authPartialUpdate } from "@shared/api/generated/auth/auth";
import {
  ThemeEnum,
  type UserProfileUpdateRequest,
} from "@shared/api/generated/models";
import { isSupportedLanguageCode } from "@shared/i18n/languages";

/**
 * Load a dayjs locale on demand. English is built into dayjs and
 * needs no import. Each ``await import("dayjs/locale/<lang>")`` is
 * a separate string literal so Vite can statically split each locale
 * into its own chunk — the user only downloads the locale they
 * actually use, instead of all 4 eagerly on every app boot.
 *
 * Silent fallback on unknown / unimportable language: dayjs.locale()
 * will use the built-in English without error if the named locale
 * isn't registered.
 */
async function loadDayjsLocale(language: string): Promise<void> {
  if (language === "en") return;
  try {
    switch (language) {
      case "de":
        await import("dayjs/locale/de");
        return;
      case "fr":
        await import("dayjs/locale/fr");
        return;
      case "it":
        await import("dayjs/locale/it");
        return;
      default:
        return;
    }
  } catch (err) {
    console.warn(`Failed to load dayjs locale "${language}":`, err);
  }
}

/** Activate the requested locale on dayjs once it's been (lazily)
 * registered. Synchronous call sites use this fire-and-forget; the
 * brief window between the call and the chunk arriving is invisible
 * in practice because most user-visible date rendering happens
 * after at least one paint. */
function applyDayjsLocale(language: string): void {
  loadDayjsLocale(language)
    .then(() => dayjs.locale(language))
    .catch((err) =>
      console.warn(`Failed to activate dayjs locale "${language}":`, err),
    );
}

interface UserPreferences {
  language?: string;
  theme?: ThemeEnum;
  sidebar_collapsed?: boolean;
}

interface LocaleContextValue {
  language: string;
  /** The theme in effect: the user's choice, or the device's under ``system``. */
  theme: "light" | "dark";
  /** What the user chose: light, dark, or ``system`` to follow the device. */
  themePreference: ThemeEnum;
  sidebarCollapsed: boolean;
  loading: boolean;
  error: string | null;
  saveLanguage: (newLanguage: string) => Promise<void>;
  saveThemePreference: (preference: ThemeEnum) => Promise<void>;
  saveSidebarCollapsed: (newSidebarCollapsed: boolean) => Promise<void>;
  savePreferences: (newPreferences: UserPreferences) => Promise<void>;
  setLanguage: (newLanguage: string) => void;
  setSidebarCollapsed: (newSidebarCollapsed: boolean) => void;
  toggleSidebar: () => void;
  getBrowserLanguage: () => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const DEVICE_PREFERS_DARK = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemeEnum {
  return Object.values(ThemeEnum).includes(value as ThemeEnum);
}

/** Whether the device is set to dark, following it when that changes. */
function useDeviceIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia(DEVICE_PREFERS_DARK).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(DEVICE_PREFERS_DARK);
    const follow = (event: MediaQueryListEvent) => setIsDark(event.matches);
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return isDark;
}

/* eslint-disable-next-line react-refresh/only-export-components --
   the hook is the only way into the private context above */
export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}

/**
 * Whether the dark theme is on, for code that picks a colour in JS rather than
 * through a CSS variable — a chart writes its series colours into SVG
 * attributes. Light outside a LocaleProvider.
 */
/* eslint-disable-next-line react-refresh/only-export-components --
   like useLocale, a way into the private context above */
export function useIsDarkTheme(): boolean {
  return useContext(LocaleContext)?.theme === "dark";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Direct ``useContext`` instead of ``useTenant()`` because LocaleProvider
  // is also mounted on the platform (super-admin) domain where there is no
  // TenantProvider — ``useTenant()`` would throw.
  const tenantCtx = useContext(TenantContext);
  const tenantLanguage = tenantCtx?.tenant?.tenant_language ?? null;
  const [language, setLanguage] = useState("en");
  const [themePreference, setThemePreference] = useState<ThemeEnum>(
    ThemeEnum.system,
  );
  const deviceIsDark = useDeviceIsDark();
  const theme =
    themePreference === ThemeEnum.system
      ? deviceIsDark
        ? "dark"
        : "light"
      : themePreference;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get browser language as fallback
  const getBrowserLanguage = useCallback(() => {
    const browserLang =
      navigator.language ||
      (navigator as unknown as { userLanguage?: string }).userLanguage;
    return browserLang?.split("-")[0] || "en"; // Get just the language code (e.g., 'en' from 'en-US')
  }, []);

  // Initialize language from user, tenant, or browser.
  //
  // Precedence:
  //   1. ``user.user_language`` — the logged-in user's saved preference
  //      wins. They explicitly set this on their profile.
  //   2. ``tenant.tenant_language`` — used pre-login (LoginPage) AND
  //      post-logout so the marketing/auth surface speaks the tenant's
  //      configured language instead of whatever the browser thinks.
  //   3. Browser ``navigator.language`` — last resort, e.g. when the
  //      LocaleProvider runs on the platform domain (no TenantProvider
  //      mounted) before the super-admin signs in.
  useEffect(() => {
    let initialLanguage = "en"; // Default fallback
    let initialSidebarCollapsed = false;

    if (user?.user_language) {
      initialLanguage = user.user_language;
    } else if (tenantLanguage) {
      initialLanguage = tenantLanguage;
    } else {
      // Use browser language detection
      initialLanguage = getBrowserLanguage();
    }

    // The signed-in user's saved choice; signed out, the last one made in this
    // browser; and with neither, the device decides.
    const userThemePreference = user?.theme;
    const storedThemePreference = localStorage.getItem("theme");
    let initialThemePreference: ThemeEnum = ThemeEnum.system;
    if (isThemePreference(userThemePreference)) {
      initialThemePreference = userThemePreference;
    } else if (isThemePreference(storedThemePreference)) {
      initialThemePreference = storedThemePreference;
    }

    if (user?.sidebar_collapsed !== undefined) {
      initialSidebarCollapsed = user.sidebar_collapsed;
    } else {
      // Check localStorage for sidebar preference
      const savedSidebarState = localStorage.getItem("sidebarCollapsed");
      initialSidebarCollapsed = savedSidebarState === "true";
    }

    setLanguage(initialLanguage);
    setThemePreference(initialThemePreference);
    setSidebarCollapsed(initialSidebarCollapsed);
    applyDayjsLocale(initialLanguage);
    // ``tenantLanguage`` arrives asynchronously after the pre-login
    // tenant bootstrap fetch — re-running this effect when it
    // resolves is what makes the LoginPage flip from browser-default
    // to the tenant's configured language.
  }, [user, tenantLanguage, getBrowserLanguage]);

  // Update dayjs locale when language changes
  useEffect(() => {
    applyDayjsLocale(language);
  }, [language]);

  // Kept in this browser for the signed-out pages.
  useEffect(() => {
    localStorage.setItem("theme", themePreference);
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", sidebarCollapsed.toString());
  }, [sidebarCollapsed]);

  // Save preferences to backend
  const savePreferences = useCallback(
    async (newPreferences: UserPreferences) => {
      if (!user) {
        // If no user, just update local state
        if (newPreferences.language) {
          setLanguage(newPreferences.language);
          applyDayjsLocale(newPreferences.language);
        }
        if (newPreferences.theme) {
          setThemePreference(newPreferences.theme);
        }
        if (newPreferences.sidebar_collapsed !== undefined) {
          setSidebarCollapsed(newPreferences.sidebar_collapsed);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Only fields the server persists for a profile PATCH;
        // sidebar_collapsed is a local-only preference.
        const profilePayload: UserProfileUpdateRequest = {};
        // A language from browser/tenant detection can be anything — switch
        // the UI to it locally below, but never send an unsupported code to
        // the server, whose choice field would 400.
        if (isSupportedLanguageCode(newPreferences.language)) {
          profilePayload.user_language = newPreferences.language;
        }
        if (newPreferences.theme) {
          profilePayload.theme = newPreferences.theme;
        }
        if (Object.keys(profilePayload).length > 0) {
          await authPartialUpdate(String(user.id), profilePayload);
        }

        // Update local state
        if (newPreferences.language) {
          setLanguage(newPreferences.language);
          applyDayjsLocale(newPreferences.language);
        }
        if (newPreferences.theme) {
          setThemePreference(newPreferences.theme);
        }
        if (newPreferences.sidebar_collapsed !== undefined) {
          setSidebarCollapsed(newPreferences.sidebar_collapsed);
        }

        // Update auth data in localStorage
        try {
          const storedAuth = localStorage.getItem("auth");
          if (storedAuth) {
            const auth = JSON.parse(storedAuth);
            if (auth.user) {
              if (newPreferences.language)
                auth.user.user_language = newPreferences.language;
              if (newPreferences.theme) auth.user.theme = newPreferences.theme;
              if (newPreferences.sidebar_collapsed !== undefined)
                auth.user.sidebar_collapsed = newPreferences.sidebar_collapsed;
              localStorage.setItem("auth", JSON.stringify(auth));
            }
          }
        } catch (storageError) {
          console.error("Failed to update stored auth:", storageError);
        }
      } catch (err) {
        console.error("Failed to save preferences:", err);
        const errorMessage =
          (err as Error).message || "Failed to save preferences";
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  // Save language to backend and update auth
  const saveLanguage = useCallback(
    async (newLanguage: string) => {
      if (!newLanguage || newLanguage === language) {
        return;
      }
      await savePreferences({ language: newLanguage });
    },
    [language, savePreferences],
  );

  const saveThemePreference = useCallback(
    async (preference: ThemeEnum) => {
      if (preference === themePreference) {
        return;
      }
      await savePreferences({ theme: preference });
    },
    [themePreference, savePreferences],
  );

  const saveSidebarCollapsed = useCallback(
    async (newSidebarCollapsed: boolean) => {
      if (newSidebarCollapsed === sidebarCollapsed) {
        return;
      }
      await savePreferences({ sidebar_collapsed: newSidebarCollapsed });
    },
    [sidebarCollapsed, savePreferences],
  );

  // Set language without saving to backend (for temporary changes)
  const setLanguageLocal = useCallback((newLanguage: string) => {
    setLanguage(newLanguage);
    applyDayjsLocale(newLanguage);
  }, []);

  const setSidebarCollapsedLocal = useCallback(
    (newSidebarCollapsed: boolean) => {
      setSidebarCollapsed(newSidebarCollapsed);
    },
    [],
  );

  const toggleSidebar = useCallback(() => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    // Auto-save the preference
    if (user) {
      saveSidebarCollapsed(newState).catch(console.error);
    }
  }, [sidebarCollapsed, user, saveSidebarCollapsed]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      theme,
      themePreference,
      sidebarCollapsed,
      loading,
      error,
      saveLanguage,
      saveThemePreference,
      saveSidebarCollapsed,
      savePreferences,
      setLanguage: setLanguageLocal,
      setSidebarCollapsed: setSidebarCollapsedLocal,
      toggleSidebar,
      getBrowserLanguage,
    }),
    [
      language,
      theme,
      themePreference,
      sidebarCollapsed,
      loading,
      error,
      saveLanguage,
      saveThemePreference,
      saveSidebarCollapsed,
      savePreferences,
      setLanguageLocal,
      setSidebarCollapsedLocal,
      toggleSidebar,
      getBrowserLanguage,
    ],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
