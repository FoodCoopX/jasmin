import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axe } from "@/test/axe";
import { SUPPORTED_LANGUAGES } from "@shared/i18n/languages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const locale = vi.hoisted(() => ({
  language: "de",
  saveLanguage: vi.fn((_code: string) => Promise.resolve()),
}));
vi.mock("@shared/contexts/LocaleContext", () => ({
  useLocale: () => locale,
}));

import LanguageSwitcher from "../LanguageSwitcher";

/** The entry the shared language list holds for ``code``. */
const languageOf = (code: string) =>
  SUPPORTED_LANGUAGES.find((language) => language.code === code)!;

const switcher = () =>
  screen.getByRole("combobox", { name: "common.language" });

/** Open the list and return it. */
async function openList(): Promise<HTMLElement> {
  await userEvent.setup().click(switcher());
  return screen.findByRole("listbox");
}

/** What the closed select shows as the language in effect. */
const shownLanguage = (container: HTMLElement) =>
  container.querySelector(".ant-select-selection-item")?.textContent ?? null;

const pressKey = (key: string, which: number) =>
  fireEvent.keyDown(switcher(), { key, keyCode: which, which });

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    locale.language = "de";
    locale.saveLanguage.mockClear();
  });

  it("is named for screen readers", () => {
    render(<LanguageSwitcher />);

    expect(switcher()).toBeInTheDocument();
  });

  it("lists the languages the app offers, each read by its own name with the label and flag shown", async () => {
    render(<LanguageSwitcher />);

    const options = within(await openList()).getAllByRole("option");

    expect(options).toHaveLength(SUPPORTED_LANGUAGES.length);
    SUPPORTED_LANGUAGES.forEach(({ code, label, name, flag }, index) => {
      expect(options[index]).toHaveAccessibleName(name);
      expect(options[index]).toHaveAttribute("lang", code);
      expect(options[index]).toHaveTextContent(label);
      expect(within(options[index]).getByText(flag)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });
  });

  it.each(["de", "en"])(
    "shows %s, the language in effect, and tells screen readers its name",
    (code) => {
      locale.language = code;
      const { container } = render(<LanguageSwitcher />);

      expect(shownLanguage(container)).toBe(languageOf(code).label);
      expect(switcher()).toHaveAccessibleDescription(languageOf(code).name);
    },
  );

  it("shows no language for one the app doesn't offer", () => {
    locale.language = "fr";
    const { container } = render(<LanguageSwitcher />);

    expect(shownLanguage(container)).toBeNull();
    expect(switcher()).not.toHaveAttribute("aria-describedby");
  });

  it("saves the language picked", async () => {
    render(<LanguageSwitcher />);

    const list = await openList();
    await userEvent
      .setup()
      .click(within(list).getByRole("option", { name: languageOf("en").name }));

    expect(locale.saveLanguage).toHaveBeenCalledWith("en");
  });

  it("can be worked from the keyboard", async () => {
    render(<LanguageSwitcher />);

    await userEvent.setup().tab();
    expect(switcher()).toHaveFocus();
    // rc-select reads the legacy ``which`` that browsers set and user-event
    // leaves out, so the keys go in as low-level events. Open on the language
    // in effect, step to the next one, take it.
    pressKey("ArrowDown", 40);
    await screen.findByRole("listbox");
    pressKey("ArrowDown", 40);
    pressKey("Enter", 13);

    expect(locale.saveLanguage).toHaveBeenCalledWith("en");
  });

  it("has no axe violations, closed or open", async () => {
    const { container } = render(<LanguageSwitcher />);

    expect(await axe(container)).toHaveNoViolations();

    await openList();
    // The list's opening animation updates state while axe runs.
    const openResults = await act(() => axe(document.body));

    expect(openResults).toHaveNoViolations();
  });
});
