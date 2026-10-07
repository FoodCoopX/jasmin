/**
 * A language's entry in the user menu shows the short label for the eye and
 * gives a screen reader the language's own name.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@shared/i18n/languages";
import LanguageMenuItemLabel from "../LanguageMenuItemLabel";

const [GERMAN, ENGLISH] = SUPPORTED_LANGUAGES;

function renderEntry(isCurrent: boolean, language = GERMAN) {
  // The menu renders each entry inside a menu item; its accessible name is
  // what a screen reader announces for the entry.
  render(
    <div role="menuitem">
      <LanguageMenuItemLabel language={language} isCurrent={isCurrent} />
    </div>,
  );
  return screen.getByRole("menuitem");
}

describe("LanguageMenuItemLabel", () => {
  it.each([
    ["Deutsch", GERMAN],
    ["English", ENGLISH],
  ])("is announced by the language's own name, %s", (name, language) => {
    const entry = renderEntry(false, language);

    expect(entry).toHaveAccessibleName(name);
    expect(screen.getByText(name)).toHaveAttribute("lang", language.code);
  });

  it("shows the short label and the flag", () => {
    const entry = renderEntry(false);

    expect(entry).toHaveTextContent(GERMAN.label);
    expect(entry).toHaveTextContent(GERMAN.flag);
    expect(screen.getByText(GERMAN.label)).toHaveAttribute("title", "Deutsch");
  });

  it("marks the language in effect, and only that one", () => {
    const current = renderEntry(true);
    expect(current).toHaveTextContent("✓");
    // The check mark is for the eye; the name stays the entry's whole name.
    expect(current).toHaveAccessibleName("Deutsch");
  });

  it("shows no check mark for another language", () => {
    expect(renderEntry(false)).not.toHaveTextContent("✓");
  });
});
