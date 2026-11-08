import type { ShareTypeVariation } from "@shared/api/generated/models";
import { lastDayInRange } from "@shared/utils/validityRange";

export interface PriceRow {
  id: string;
  name: string;
  reference: number;
  avg: number | null;
  count: number;
}

interface PriceRowsOptions {
  /** The range as YYYY-MM-DD dates, both included; null for none. */
  range: [string, string] | null;
  /** The prices paid per variation id, by the subscriptions started in it. */
  paidPricesByVariation: Map<string, number[]>;
  /** The variation's reference price on `date`; today's for a null date. */
  referencePriceOn: (variation: ShareTypeVariation, date: string | null) => string | null;
  nameOf: (variation: ShareTypeVariation) => string;
}

/**
 * One row per variation running at some point of the range: the average price
 * its subscribers chose against its reference price on its last day in the
 * range. Without a range, every variation, at today's reference price.
 */
export function buildSolidarityPriceRows(
  variations: ShareTypeVariation[],
  { range, paidPricesByVariation, referencePriceOn, nameOf }: PriceRowsOptions,
): PriceRow[] {
  return variations.flatMap((variation) => {
    const lastDay = range ? lastDayInRange(variation, ...range) : null;
    if (range && !lastDay) return [];
    const prices = paidPricesByVariation.get(variation.id ?? "") ?? [];
    return {
      id: variation.id ?? "",
      name: nameOf(variation),
      reference: parseFloat(referencePriceOn(variation, lastDay) ?? "0"),
      avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
      count: prices.length,
    };
  });
}
