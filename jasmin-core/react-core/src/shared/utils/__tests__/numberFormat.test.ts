import { describe, expect, it, vi } from "vitest";
import {
  blockNonNumericKeys,
  formatNumber,
  getLocaleSeparators,
  normalizeNumberInputText,
  parseDecimalInput,
  parseLocaleNumber,
} from "../numberFormat";

describe("formatNumber", () => {
  it("formats integers with the locale's decimal + grouping", () => {
    expect(formatNumber(1234567.89, 2, "de-DE")).toBe("1.234.567,89");
    expect(formatNumber(1234567.89, 2, "en-US")).toBe("1,234,567.89");
    expect(formatNumber(1234567.89, 2, "fr-FR")).toMatch(/1.234.567,89/);
  });

  it("honors the requested decimal count exactly", () => {
    expect(formatNumber(7, 2, "de-DE")).toBe("7,00");
    expect(formatNumber(7.5, 0, "de-DE")).toBe("8"); // rounds
    expect(formatNumber(7.555, 2, "de-DE")).toBe("7,56");
  });

  it('returns "" for nullish / empty / NaN', () => {
    expect(formatNumber(null, 2, "de-DE")).toBe("");
    expect(formatNumber(undefined, 2, "de-DE")).toBe("");
    expect(formatNumber("", 2, "de-DE")).toBe("");
    expect(formatNumber("not a number", 2, "de-DE")).toBe("");
    expect(formatNumber(NaN, 2, "de-DE")).toBe("");
    expect(formatNumber(Infinity, 2, "de-DE")).toBe("");
  });

  it("accepts string numerics and Decimal-shaped strings", () => {
    // Backend sometimes returns Decimal as a string with canonical ".".
    expect(formatNumber("98.00", 2, "de-DE")).toBe("98,00");
    expect(formatNumber("98", 0, "de-DE")).toBe("98");
    expect(formatNumber("19.5", 2, "de-DE")).toBe("19,50");
  });

  it("handles negative values", () => {
    expect(formatNumber(-12.34, 2, "de-DE")).toBe("-12,34");
    expect(formatNumber(-12.34, 2, "en-US")).toBe("-12.34");
  });
});

describe("parseLocaleNumber", () => {
  it("interprets input via the locale's own separator conventions", () => {
    // In de-DE "." is the GROUPING char and "," is the decimal, so
    // "12.34" reads as twelve-thousand-three-hundred-and-forty — that's
    // the correct Intl semantics. We never feed canonical "." strings
    // into parse() in production; the form layer converts user input
    // ("12,34") to canonical "12.34" via getValueFromEvent.
    expect(parseLocaleNumber("12.34", "de-DE")).toBe(1234);
    // en-US: "." is decimal, no grouping change.
    expect(parseLocaleNumber("12.34", "en-US")).toBe(12.34);
  });

  it("parses locale-formatted input back to a JS number", () => {
    expect(parseLocaleNumber("12,34", "de-DE")).toBe(12.34);
    expect(parseLocaleNumber("1.234,56", "de-DE")).toBe(1234.56);
    expect(parseLocaleNumber("1,234.56", "en-US")).toBe(1234.56);
  });

  it("strips thousand grouping", () => {
    expect(parseLocaleNumber("1.234.567,89", "de-DE")).toBe(1234567.89);
    expect(parseLocaleNumber("1,234,567.89", "en-US")).toBe(1234567.89);
  });

  it("returns null for empty / invalid / non-numeric", () => {
    expect(parseLocaleNumber("", "de-DE")).toBeNull();
    expect(parseLocaleNumber(null, "de-DE")).toBeNull();
    expect(parseLocaleNumber(undefined, "de-DE")).toBeNull();
    expect(parseLocaleNumber("hello", "de-DE")).toBeNull();
  });

  it("passes JS numbers through unchanged", () => {
    expect(parseLocaleNumber(12.34, "de-DE")).toBe(12.34);
    expect(parseLocaleNumber(0, "de-DE")).toBe(0);
    expect(parseLocaleNumber(NaN, "de-DE")).toBeNull();
  });
});

describe("getLocaleSeparators", () => {
  it("derives correct separators for known locales", () => {
    expect(getLocaleSeparators("de-DE")).toEqual({
      decimalChar: ",",
      groupChar: ".",
    });
    expect(getLocaleSeparators("en-US")).toEqual({
      decimalChar: ".",
      groupChar: ",",
    });
  });
});

// ---------------------------------------------------------------------------
// Round-trip — what we ultimately rely on: a value can survive
// format -> parse -> format and stay identical (modulo precision).
// ---------------------------------------------------------------------------
describe("format / parse round-trip", () => {
  it.each([
    ["de-DE", 7, 0, "7"],
    ["de-DE", 7.5, 2, "7,50"],
    ["de-DE", 1234.56, 2, "1.234,56"],
    ["en-US", 1234.56, 2, "1,234.56"],
  ])(
    "%s: %f (%i decimals) round-trips through format/parse",
    (locale, value, decimals, expectedDisplay) => {
      const displayed = formatNumber(value, decimals, locale);
      expect(displayed).toBe(expectedDisplay);
      const parsedBack = parseLocaleNumber(displayed, locale);
      expect(parsedBack).toBe(Number(value.toFixed(decimals)));
    },
  );
});

describe("parseDecimalInput", () => {
  it("reads a comma or a point as the decimal separator", () => {
    expect(parseDecimalInput("2,90")).toBe(2.9);
    expect(parseDecimalInput("2.90")).toBe(2.9);
    expect(parseDecimalInput("12,")).toBe(12);
  });

  it("passes numbers through", () => {
    expect(parseDecimalInput(1.5)).toBe(1.5);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput(null)).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
  });
});

describe("normalizeNumberInputText", () => {
  it.each([
    ["2,50", "2.50"],
    ["2.50", "2.50"],
    ["1,000", "1.000"],
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    // fr-FR groups with a narrow no-break space, de-AT with a no-break space.
    ["1 234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["€ 2,50", "2.50"],
    ["2,", "2."],
    [",5", ".5"],
    ["-2,5", "-2.5"],
    ["", ""],
    ["  ", ""],
    // Two decimal marks: no number, so the field keeps its last valid value.
    ["1,2,3", "1.2.3"],
  ])("on a tenant with a decimal comma reads %j as %j", (text, expected) => {
    expect(normalizeNumberInputText(text, ",")).toBe(expected);
  });

  it.each([
    ["2.50", "2.50"],
    ["2,50", "2.50"],
    ["1,5", "1.5"],
    ["0,500", "0.500"],
    ["1,000", "1000"],
    ["12,345,678", "12345678"],
    ["-1,000", "-1000"],
    ["£1,000", "1000"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    // de-CH groups with an apostrophe, typed or typographic.
    ["1'234.56", "1234.56"],
    ["1’234.56", "1234.56"],
    ["", ""],
    ["1,2,3", "1.2.3"],
  ])("on a tenant with a decimal point reads %j as %j", (text, expected) => {
    expect(normalizeNumberInputText(text, ".")).toBe(expected);
  });

  it("reads a locale's own decimal mark as the point", () => {
    expect(normalizeNumberInputText("1٫5", "٫")).toBe("1.5");
  });

  // NumberInput shows a value at its precision with the tenant's decimal mark
  // and no grouping; leaving the field reads that text back.
  it.each(["de-DE", "de-CH", "en-US", "fr-FR"])(
    "%s: what the field shows reads back as the same number",
    (locale) => {
      const { decimalChar } = getLocaleSeparators(locale);
      for (const value of [0, 1.5, 2.05, 1234.56, 1000, -12.34]) {
        const shown = value.toFixed(2).replace(".", decimalChar);
        expect(Number(normalizeNumberInputText(shown, decimalChar))).toBe(value);
      }
    },
  );
});

describe("blockNonNumericKeys", () => {
  /** Whether the handler lets ``key`` through. */
  function passes(
    handler: ReturnType<typeof blockNonNumericKeys>,
    key: string,
    modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {},
  ) {
    const preventDefault = vi.fn();
    handler({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...modifiers,
      preventDefault,
    });
    return preventDefault.mock.calls.length === 0;
  }

  it("lets both decimal marks into a decimal field and neither into a whole-number one", () => {
    const decimals = blockNonNumericKeys({ allowDecimal: true });
    const wholeNumbers = blockNonNumericKeys({ allowDecimal: false });

    expect([".", ","].map((key) => passes(decimals, key))).toEqual([true, true]);
    expect([".", ","].map((key) => passes(wholeNumbers, key))).toEqual([false, false]);
    for (const handler of [decimals, wholeNumbers]) {
      expect(passes(handler, "7")).toBe(true);
      expect(passes(handler, "Backspace")).toBe(true);
      expect(passes(handler, "v", { metaKey: true })).toBe(true);
      expect(passes(handler, "e")).toBe(false);
      expect(passes(handler, "-")).toBe(false);
    }
    expect(
      passes(blockNonNumericKeys({ allowDecimal: true, allowNegative: true }), "-"),
    ).toBe(true);
  });
});
