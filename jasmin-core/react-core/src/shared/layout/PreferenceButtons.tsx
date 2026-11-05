import { GlobalOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space } from "antd";
import { useTranslation } from "react-i18next";
import { useLocale } from "@shared/contexts/LocaleContext";
import { THEME_ICONS, usePreferenceMenuItems } from "./usePreferenceMenuItems";

/**
 * The language and the theme as two small buttons, in place of the user menu
 * where a host application owns the logins and the data protection: the menu
 * would hold nothing else. The theme button shows the theme picked.
 */
export default function PreferenceButtons() {
  const { t } = useTranslation();
  const { themePreference } = useLocale();
  const { languageItems, themeItems } = usePreferenceMenuItems();

  return (
    <Space size={4}>
      <Dropdown
        menu={{ items: languageItems }}
        placement="bottomRight"
        trigger={["click"]}
      >
        <Button
          type="text"
          size="small"
          className="preference-button"
          icon={<GlobalOutlined />}
          aria-label={t("profile.menu_language")}
          title={t("profile.menu_language")}
        />
      </Dropdown>
      <Dropdown
        menu={{ items: themeItems }}
        placement="bottomRight"
        trigger={["click"]}
      >
        <Button
          type="text"
          size="small"
          className="preference-button"
          icon={THEME_ICONS[themePreference]}
          aria-label={t("profile.menu_theme")}
          title={t("profile.menu_theme")}
        />
      </Dropdown>
    </Space>
  );
}
