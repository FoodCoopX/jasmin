import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Space } from "antd";
import type { MenuProps } from "antd";
import { useTranslation } from "react-i18next";
import { ThemeEnum } from "@shared/api/generated/models";
import { useLocale } from "@shared/contexts/LocaleContext";
import { SUPPORTED_LANGUAGES } from "@shared/i18n/languages";
import LanguageMenuItemLabel from "./LanguageMenuItemLabel";

type MenuItem = NonNullable<MenuProps["items"]>[number];

/** The themes on offer, each with its icon. */
export const THEME_ICONS = {
  [ThemeEnum.system]: <DesktopOutlined />,
  [ThemeEnum.light]: <SunOutlined />,
  [ThemeEnum.dark]: <MoonOutlined />,
};

/**
 * The entries that pick a language and a theme, the current one marked, for
 * the user menu's submenus and the preference buttons that stand in for it
 * where a host owns the logins. A failed save has already been shown to the
 * user by LocaleContext, so the rejection is taken up here.
 */
export function usePreferenceMenuItems(): {
  languageItems: MenuItem[];
  themeItems: MenuItem[];
} {
  const { t } = useTranslation();
  const { language, saveLanguage, themePreference, saveThemePreference } =
    useLocale();

  const languageItems: MenuItem[] = SUPPORTED_LANGUAGES.map((lang) => ({
    key: `language-${lang.code}`,
    label: (
      <LanguageMenuItemLabel
        language={lang}
        isCurrent={language === lang.code}
      />
    ),
    onClick: () => {
      saveLanguage(lang.code).catch(() => undefined);
    },
  }));

  const themeLabels = {
    [ThemeEnum.system]: t("profile.theme_system"),
    [ThemeEnum.light]: t("profile.theme_light"),
    [ThemeEnum.dark]: t("profile.theme_dark"),
  };
  const themeItems: MenuItem[] = (
    [ThemeEnum.system, ThemeEnum.light, ThemeEnum.dark] as const
  ).map((preference) => ({
    key: `theme-${preference}`,
    icon: THEME_ICONS[preference],
    label: (
      <Space>
        <span>{themeLabels[preference]}</span>
        {themePreference === preference && (
          <span aria-hidden className="theme-menu-item__check">
            ✓
          </span>
        )}
      </Space>
    ),
    onClick: () => {
      saveThemePreference(preference).catch(() => undefined);
    },
  }));

  return { languageItems, themeItems };
}
