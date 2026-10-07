import { Space } from "antd";
import type { SupportedLanguage } from "@shared/i18n/languages";

interface LanguageMenuItemLabelProps {
  language: SupportedLanguage;
  isCurrent: boolean;
}

/**
 * A language's entry in the user menu: the flag and short ``label`` for the
 * eye, and the language's own ``name``, in that language, for a screen reader,
 * which would otherwise spell a label such as "DE" letter by letter. The name
 * is the hover title too. A check mark shows the language in effect.
 */
export default function LanguageMenuItemLabel({
  language,
  isCurrent,
}: LanguageMenuItemLabelProps) {
  return (
    <Space>
      <span aria-hidden>{language.flag}</span>
      <span>
        <span aria-hidden title={language.name}>
          {language.label}
        </span>
        <span className="sr-only" lang={language.code}>
          {language.name}
        </span>
      </span>
      {isCurrent && (
        <span aria-hidden className="language-menu-item__check">
          ✓
        </span>
      )}
    </Space>
  );
}
