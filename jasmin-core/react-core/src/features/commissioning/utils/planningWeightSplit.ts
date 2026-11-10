/**
 * Client-side mirror of
 * ``apps/commissioning/utils/forecast_distribution.py::split_forecast_amount_by_weight``,
 * plus the week count behind the long-term list's ``needed_amount`` — powers the reverse
 * total-amount input mode (``commissioning.planning_long_term.mode_total``) on
 * the long-term planning page, which suggests a per-share amount from a target
 * total.
 *
 * KEEP IN SYNC with the Python source: the floor step (0.10 by default), the
 * 99.99 cap, and the "skip missing / ≤ 0 average_weight" rule are duplicated
 * here. The split only seeds an EDITABLE suggestion (the office adjusts, then
 * saves; the backend recomputes needed_amount authoritatively), so a sub-0.10
 * divergence from the Python Decimal path is acceptable — but the RULES
 * themselves must match. Fixtures in ``planningWeightSplit.test.ts`` are the
 * tripwire; the parallel Python cases live in
 * ``tests_utils/test_forecast_distribution.py``.
 */

export interface VariationWeightCount {
  variationId: string;
  /** kg (or the row's unit) per single share of this size; null → skipped. */
  averageWeight: number | null;
  /** physical shares of this size delivered per week (subscriber snapshot). */
  subscriberCount: number;
  /** The planned weeks this size runs in; all of them when left out. A size
   *  replaced during the year shares the weeks with its successor. */
  weeks?: number;
}

export interface WeightSplitResult {
  /** suggested per-share amount, keyed by variation id (eligible sizes only). */
  amountsByVariation: Record<string, number>;
  /** Σ count × amount × weeks — the total the suggestion hands out (≤ target). */
  actualTotal: number;
  /** false when nothing can be distributed (target ≤ 0, 0 weeks, no eligible
   *  size with a positive weight, or the weighted denominator is 0). */
  distributable: boolean;
}

const DEFAULT_FLOOR_STEP = 0.1;
const DEFAULT_CAP = 99.99;
const DEFAULT_CAP_THRESHOLD = 99.9;

/**
 * Floor ``value`` down to a multiple of ``step`` (e.g. 0.10). Rounds away float
 * noise first (``toFixed(6)``) so a mathematically-exact 40.0 that arrives as
 * 39.99999999 floors to 40.0, not 39.9 — the visible off-by-a-tenth the naive
 * ``Math.floor(value / step) * step`` would produce.
 */
function floorToStep(value: number, step: number): number {
  const steps = Math.floor(Number((value / step).toFixed(6)));
  return Number((steps * step).toFixed(6));
}

interface WeekPattern {
  onlyOdd?: boolean;
  onlyEven?: boolean;
  onlyEveryThree?: boolean;
}

/**
 * The delivery weeks in ``[range1, range2]`` after the parity pattern —
 * mirror of ``DefaultShareContentService._filter_weeks``. ``onlyEveryThree``
 * keeps every third week counting from ``range1``.
 */
export function deliveryWeekNumbers(
  range1: number | null | undefined,
  range2: number | null | undefined,
  pattern: WeekPattern = {},
): number[] {
  if (range1 == null || range2 == null) return [];
  const start = Number(range1);
  const end = Number(range2);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const weeks: number[] = [];
  for (let week = start; week <= end; week++) {
    if (pattern.onlyOdd && week % 2 === 0) continue;
    if (pattern.onlyEven && week % 2 !== 0) continue;
    if (pattern.onlyEveryThree && (week - start) % 3 !== 0) continue;
    weeks.push(week);
  }
  return weeks;
}


/**
 * Suggest a per-share amount for each size that distributes ``targetTotal``
 * across the whole planning window, proportional to ``averageWeight`` and
 * weighted by ``subscriberCount`` and the weeks the size runs in.
 *
 * The inverse of ``needed_amount = Σ (count × amount × weeks)``:
 *
 *   perWeightUnit = targetTotal / Σ (count × weight × weeks[size])
 *   amount[size]  = floorToStep(weight[size] × perWeightUnit)
 *
 * so a size that weighs half of another gets half the amount, and the total
 * actually handed out is ≤ ``targetTotal`` (floored, never over-allocates).
 */
export function suggestPerShareAmounts(
  targetTotal: number,
  numFilteredWeeks: number,
  variations: VariationWeightCount[],
  options?: { floorStep?: number; cap?: number; capThreshold?: number },
): WeightSplitResult {
  const floorStep = options?.floorStep ?? DEFAULT_FLOOR_STEP;
  const cap = options?.cap ?? DEFAULT_CAP;
  const capThreshold = options?.capThreshold ?? DEFAULT_CAP_THRESHOLD;

  const empty: WeightSplitResult = {
    amountsByVariation: {},
    actualTotal: 0,
    distributable: false,
  };

  if (!(targetTotal > 0) || !(numFilteredWeeks > 0)) return empty;

  const weeksOf = (v: VariationWeightCount) => v.weeks ?? numFilteredWeeks;

  // Eligible = sizes with a positive average_weight (mirrors the Python skip;
  // a size with no weight can't be weighted, so it gets no suggestion), and
  // that run in one of the weeks at all.
  const eligible = variations.filter(
    (v): v is VariationWeightCount & { averageWeight: number } =>
      v.averageWeight != null && v.averageWeight > 0 && weeksOf(v) > 0,
  );

  const denominator = eligible.reduce(
    (sum, v) => sum + (v.subscriberCount || 0) * v.averageWeight * weeksOf(v),
    0,
  );
  if (!(denominator > 0)) return empty;

  const perWeightUnit = targetTotal / denominator;

  const amountsByVariation: Record<string, number> = {};
  let actualTotal = 0;
  for (const v of eligible) {
    let amount = floorToStep(v.averageWeight * perWeightUnit, floorStep);
    if (amount > capThreshold) amount = cap;
    amountsByVariation[v.variationId] = amount;
    actualTotal += (v.subscriberCount || 0) * amount * weeksOf(v);
  }

  return {
    amountsByVariation,
    actualTotal: Number(actualTotal.toFixed(3)),
    distributable: true,
  };
}
