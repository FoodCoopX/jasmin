import { GlobalOutlined } from "@ant-design/icons";
import { Select } from "antd";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@shared/contexts/LocaleContext";
import { SUPPORTED_LANGUAGES } from "@shared/i18n/languages";

/**
 * Switches the language the app speaks, for a visitor who finds the language
 * taken from their browser the wrong one. The pick is kept in this browser
 * and, for a signed-in user, saved to the profile as well.
 *
 * The eye gets each language's ``label`` and flag from ``SUPPORTED_LANGUAGES``;
 * a screen reader hears its ``name``, in the language itself. The closed
 * select names the language in effect in its description: the combobox
 * rc-select renders is an empty input, and assistive technology doesn't take
 * the language shown beside it for the combobox's value.
 */
export default function LanguageSwitcher() {
  const { t } = useTranslation();
  const { language, saveLanguage } = useLocale();
  const currentLanguageId = useId();
  // The context can hold a language the app doesn't offer, from a farm
  // setting outside the list; the select then shows no selection rather than
  // the bare code.
  const current = SUPPORTED_LANGUAGES.find(({ code }) => code === language);

  return (
    <>
      <Select
        aria-label={t("common.language")}
        aria-describedby={current ? currentLanguageId : undefined}
        value={current?.code}
        onChange={(code: string) => {
          // A failed profile save is logged by the context and leaves the
          // language as it was.
          saveLanguage(code).catch(() => undefined);
        }}
        prefix={<GlobalOutlined aria-hidden />}
        // A virtual list keeps the listbox semantics on hidden copies of the
        // options; with two options there is nothing to virtualise, and the
        // list a screen reader walks is the one on screen.
        virtual={false}
        // The flags make an option wider than the closed select, so the list
        // takes its own width and opens leftwards from the select's right
        // edge, where a page puts the switcher.
        popupMatchSelectWidth={false}
        placement="bottomRight"
        options={SUPPORTED_LANGUAGES.map(({ code, label, name, flag }) => ({
          value: code,
          label,
          flag,
          "aria-label": name,
          lang: code,
        }))}
        optionRender={(option) => (
          <>
            <span aria-hidden>{option.data.flag}</span> {option.label}
          </>
        )}
      />
      {current && (
        <span id={currentLanguageId} lang={current.code} hidden>
          {current.name}
        </span>
      )}
    </>
  );
}
