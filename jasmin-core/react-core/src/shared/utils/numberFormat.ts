/**
 * Locale-aware number formatting / parsing.
 *
 * The single point of truth for how numbers look in the UI. Use the
 * `useNumberFormat` hook (which reads the tenant's `number_locale`) in
 * React code; these standalone helpers exist for non-hook contexts
 * (utils, services, PDF generation) where the locale must be passed in
 * explicitly.
 *
 * Backend wire format is always canonical "." — `parseLocaleNumber`
 * normalizes user input back to a JS number so callers never have to
 * deal with the display separator.
 */

const DEFAULT_LOCALE = "de-DE";

// Cache one Intl.NumberFormat instance per (locale, decimals) — these are
// cheap to construct but cheaper still to reuse.
const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string, decimals: number): Intl.NumberFormat {
  const key = `${locale}:${decimals}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Format a number for display in the given locale.
 *
 * Returns "" for nullish / empty / NaN input.
 */
export function formatNumber(
  value: number | string | null | undefined,
  decimals = 2,
  locale: string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return getFormatter(locale, decimals).format(n);
}

/**
 * Parse user input (possibly using the locale's decimal/grouping
 * separators) back to a JS number. Returns `null` for empty / invalid
 * input.
 *
 * Heuristic: for "de-*" / "fr-*" locales, "." is the grouping character
 * and "," is the decimal point. For everything else we assume "," is
 * grouping and "." is decimal (en-* / most others). Locales like Swiss
 * German (de-CH) use "'" for grouping — handled explicitly.
 */
export function parseLocaleNumber(
  input: string | number | null | undefined,
  locale: string = DEFAULT_LOCALE,
): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const { groupChar, decimalChar } = getLocaleSeparators(locale);

  // Strip grouping then swap decimal char for "." for parseFloat.
  let normalized = input.trim();
  if (groupChar) {
    // Escape regex special chars (".", "'" etc.).
    const escaped = groupChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(escaped, "g"), "");
  }
  if (decimalChar !== ".") {
    normalized = normalized.replace(decimalChar, ".");
  }

  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * What a decimal table input holds, as a number. Those inputs take "." or ","
 * as the decimal separator, whatever the locale, and no grouping, and their
 * `onFieldChange` handlers get the raw text — so a comma is read as the
 * decimal point. Returns `null` for empty or invalid input.
 */
export function parseDecimalInput(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * What a number typed or pasted into a ``NumberInput`` reads as: the text in
 * canonical form ("." as the decimal point, no grouping), for the field's own
 * number parser. ``decimalChar`` is the tenant's decimal mark.
 *
 * "." and "," both work as the decimal mark whatever the locale, as in the
 * table inputs, and grouping is dropped:
 * - spaces (fr-FR groups with U+202F, de-AT with a no-break space) and
 *   apostrophes (de-CH) go;
 * - with both marks in the text, the last one is the decimal mark and the
 *   other groups: "1.234,56" and "1,234.56" both read 1234.56;
 * - a lone comma is the decimal mark, except where it splits the digits of a
 *   "."-tenant into thousands: "1,000" reads 1000 there, "1,5" and "0,500"
 *   stay decimals;
 * - a tenant decimal mark other than "." or "," reads as the point too, so
 *   whatever the field shows parses back to the same number;
 * - anything else that is no part of a number (currency signs and the like)
 *   is stripped, as AntD's own parser does.
 *
 * Empty text stays "", so a cleared field reads as no value rather than 0.
 * Text with two decimal marks ("1,2,3") stays invalid, and the field keeps its
 * last valid value. Not ``parseLocaleNumber``: that reads a de-DE "2.50" as
 * 250.
 */
export function normalizeNumberInputText(
  text: string,
  decimalChar: string,
): string {
  let compact = text.replace(/[\s'’]/g, "");
  if (decimalChar !== "." && decimalChar !== ",") {
    compact = compact.replaceAll(decimalChar, ".");
  }
  const lastComma = compact.lastIndexOf(",");
  const lastPoint = compact.lastIndexOf(".");
  let canonical = compact;
  if (lastComma >= 0 && lastPoint >= 0) {
    const groupMark = lastComma > lastPoint ? "." : ",";
    canonical = compact.replaceAll(groupMark, "").replaceAll(",", ".");
  } else if (lastComma >= 0) {
    const groupsThousands =
      decimalChar === "." &&
      /^-?[1-9]\d{0,2}(,\d{3})+$/.test(compact.replace(/[^\d,-]/g, ""));
    canonical = compact.replaceAll(",", groupsThousands ? "" : ".");
  }
  return canonical.replace(/[^\w.-]+/g, "");
}

/**
 * The decimal and grouping characters this locale uses. Derived from
 * `Intl.NumberFormat.formatToParts` so we don't hard-code per-locale
 * rules — works for any BCP-47 tag the browser knows.
 */
export function getLocaleSeparators(locale: string = DEFAULT_LOCALE): {
  decimalChar: string;
  groupChar: string;
} {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.89);
  const decimalChar = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const groupChar = parts.find((p) => p.type === "group")?.value ?? ",";
  return { decimalChar, groupChar };
}

/**
 * Build a keydown handler that hard-blocks non-numeric characters in a numeric
 * input. ``NumberInput`` only coerces invalid text on blur — it does NOT stop
 * you typing "5,kers" while focused — so config number fields need this guard
 * to actually prevent invalid keystrokes. Paste of garbage is still sanitised
 * by the field's own blur coercion.
 *
 * Where decimals are allowed, "." and "," both pass: ``NumberInput`` reads
 * either as the decimal mark, whatever the tenant's locale. Whole-number
 * fields take digits only.
 *
 * Typed structurally (not React.KeyboardEvent) so this stays a React-free util;
 * the shape is satisfied by a real keyboard event, so it drops straight into
 * ``onKeyDown``.
 */
export function blockNonNumericKeys(opts: {
  allowDecimal: boolean;
  allowNegative?: boolean;
}) {
  const navKeys = new Set([
    "Backspace",
    "Delete",
    "Tab",
    "Enter",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ]);
  return (e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    preventDefault: () => void;
  }) => {
    // Let shortcuts (copy/paste/select-all) and navigation/editing keys through.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (navKeys.has(e.key)) return;
    if (/^[0-9]$/.test(e.key)) return;
    if (opts.allowNegative && e.key === "-") return;
    if (opts.allowDecimal && (e.key === "." || e.key === ",")) return;
    e.preventDefault();
  };
}
